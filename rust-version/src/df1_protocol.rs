use anyhow::{Context, Result};
use bytes::{Buf, BufMut, BytesMut};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;
use tokio_serial::{SerialPort, SerialPortBuilderExt, SerialStream};
use tracing::{debug, info, warn};

const DF1_CMD_READ: u8 = 0x0F;
const DF1_CMD_WRITE: u8 = 0x0E;
const DF1_TIMEOUT: Duration = Duration::from_millis(1200);

#[derive(Debug, Clone, Copy)]
pub enum FileType {
    Output = 0x8B,   // O
    Input = 0x8C,    // I
    Status = 0x84,   // S
    Bit = 0x85,      // B
    Timer = 0x86,    // T
    Counter = 0x87,  // C
    Control = 0x88,  // R
    Integer = 0x89,  // N
    Float = 0x8A,    // F
}

impl FileType {
    fn from_char(c: char) -> Result<Self> {
        match c.to_ascii_uppercase() {
            'O' => Ok(FileType::Output),
            'I' => Ok(FileType::Input),
            'S' => Ok(FileType::Status),
            'B' => Ok(FileType::Bit),
            'T' => Ok(FileType::Timer),
            'C' => Ok(FileType::Counter),
            'R' => Ok(FileType::Control),
            'N' => Ok(FileType::Integer),
            'F' => Ok(FileType::Float),
            _ => anyhow::bail!("Unknown file type: {}", c),
        }
    }

    fn element_size(&self) -> usize {
        match self {
            FileType::Integer | FileType::Bit => 2,
            FileType::Float => 4,
            _ => 2,
        }
    }
}

#[derive(Debug)]
pub struct DF1Address {
    pub file_type: FileType,
    pub file_num: u8,
    pub element: u8,
}

impl DF1Address {
    pub fn parse(address: &str) -> Result<Self> {
        // Parse format: "N7:0", "F8:10", etc.
        let parts: Vec<&str> = address.split(':').collect();
        if parts.len() != 2 {
            anyhow::bail!("Invalid address format: {}", address);
        }

        let type_and_num = parts[0];
        if type_and_num.is_empty() {
            anyhow::bail!("Empty address type");
        }

        let file_type = FileType::from_char(type_and_num.chars().next().unwrap())?;
        let file_num: u8 = type_and_num[1..]
            .parse()
            .with_context(|| format!("Invalid file number in {}", address))?;
        let element: u8 = parts[1]
            .parse()
            .with_context(|| format!("Invalid element in {}", address))?;

        Ok(DF1Address {
            file_type,
            file_num,
            element,
        })
    }
}

pub struct DF1Protocol {
    port: SerialStream,
    tns: u16,
    rx_buffer: BytesMut,
}

impl DF1Protocol {
    pub async fn new(port_path: &str, baud_rate: u32) -> Result<Self> {
        info!("Opening DF1 serial port: {} @ {}", port_path, baud_rate);

        let port = tokio_serial::new(port_path, baud_rate)
            .data_bits(tokio_serial::DataBits::Eight)
            .parity(tokio_serial::Parity::None)
            .stop_bits(tokio_serial::StopBits::One)
            .timeout(Duration::from_millis(100))
            .open_native_async()
            .with_context(|| format!("Failed to open serial port {}", port_path))?;

        // Clear buffers
        port.clear(tokio_serial::ClearBuffer::All)
            .context("Failed to clear serial buffers")?;

        info!("DF1 protocol initialized successfully");

        Ok(DF1Protocol {
            port,
            tns: 1,
            rx_buffer: BytesMut::with_capacity(512),
        })
    }

    fn next_tns(&mut self) -> u16 {
        let current = self.tns;
        self.tns = self.tns.wrapping_add(1);
        current
    }

    fn compute_crc(data: &[u8]) -> u16 {
        let mut crc: u16 = 0x0000;

        for &byte in data {
            crc = Self::calc_crc(crc, byte);
        }

        crc = Self::calc_crc(crc, 0x03);
        crc
    }

    fn calc_crc(mut crc: u16, value: u8) -> u16 {
        let temp = crc ^ (value as u16);
        crc = (crc & 0xFF00) | (temp & 0xFF);

        for _ in 0..8 {
            if crc & 1 != 0 {
                crc >>= 1;
                crc ^= 0xA001;
            } else {
                crc >>= 1;
            }
        }

        crc & 0xFFFF
    }

    fn create_frame(&mut self, dst: u8, src: u8, cmd: u8, data: &[u8]) -> Vec<u8> {
        let tns = self.next_tns();
        let mut frame = Vec::new();

        // Start delimiter
        frame.push(0x10);
        frame.push(0x02);

        // Build unescaped frame data
        let mut frame_data = Vec::new();
        frame_data.push(dst);
        frame_data.push(src);
        frame_data.push(cmd);
        frame_data.push(0x00); // STS
        frame_data.push((tns & 0xFF) as u8);
        frame_data.push((tns >> 8) as u8);
        frame_data.extend_from_slice(data);

        // Escape DLE characters
        for &byte in &frame_data {
            if byte == 0x10 {
                frame.push(0x10);
                frame.push(0x10);
            } else {
                frame.push(byte);
            }
        }

        // End delimiter
        frame.push(0x10);
        frame.push(0x03);

        // CRC
        let crc = Self::compute_crc(&frame_data);
        frame.push((crc & 0xFF) as u8);
        frame.push((crc >> 8) as u8);

        debug!("Created DF1 frame: {:02X?}", frame);
        frame
    }

    async fn send_ack(&mut self) -> Result<()> {
        self.port.write_all(&[0x10, 0x06]).await?;
        Ok(())
    }

    async fn send_nak(&mut self) -> Result<()> {
        self.port.write_all(&[0x10, 0x15]).await?;
        Ok(())
    }

    fn process_frame(&self, buffer: &[u8]) -> Result<Vec<u8>> {
        if buffer.len() < 4 || buffer[0] != 0x10 || buffer[1] != 0x02 {
            anyhow::bail!("Invalid frame header");
        }

        // Unescape frame
        let mut frame = Vec::new();
        let mut i = 2;
        let mut dle_flag = false;

        while i < buffer.len() - 3 {
            let byte = buffer[i];

            if byte == 0x10 {
                if dle_flag {
                    frame.push(byte);
                    dle_flag = false;
                } else {
                    dle_flag = true;
                }
            } else {
                if dle_flag && byte == 0x03 {
                    break;
                }
                frame.push(byte);
                dle_flag = false;
            }
            i += 1;
        }

        if i >= buffer.len() {
            anyhow::bail!("Frame end not found");
        }

        // Verify CRC
        let crc_received = ((buffer[i + 2] as u16) << 8) | (buffer[i + 1] as u16);
        let crc_calculated = Self::compute_crc(&frame);

        if crc_received != crc_calculated {
            warn!(
                "CRC mismatch: received={:04X}, calculated={:04X}",
                crc_received, crc_calculated
            );
            anyhow::bail!("CRC verification failed");
        }

        debug!("Frame processed successfully, length={}", frame.len());
        Ok(frame)
    }

    async fn read_response(&mut self) -> Result<Vec<u8>> {
        self.rx_buffer.clear();

        let result = timeout(DF1_TIMEOUT, async {
            loop {
                let mut buf = [0u8; 256];
                let n = self.port.read(&mut buf).await?;

                if n > 0 {
                    self.rx_buffer.put_slice(&buf[..n]);

                    // Check for ACK/ENQ
                    if self.rx_buffer.len() >= 2
                        && self.rx_buffer[0] == 0x10
                        && (self.rx_buffer[1] == 0x06 || self.rx_buffer[1] == 0x05)
                    {
                        self.rx_buffer.advance(2);
                        continue;
                    }

                    // Check if we have a complete frame
                    if self.rx_buffer.len() >= 4 && self.rx_buffer[0] == 0x10 {
                        // Wait a bit for the rest of the frame
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        break;
                    }
                }
            }

            Ok::<_, anyhow::Error>(())
        })
        .await;

        match result {
            Ok(_) => {
                let buffer = self.rx_buffer.to_vec();
                let frame = self.process_frame(&buffer)?;
                self.send_ack().await?;
                Ok(frame)
            }
            Err(_) => {
                anyhow::bail!("Timeout waiting for response")
            }
        }
    }

    pub async fn read_data(&mut self, address: &str, size: u8) -> Result<Vec<u8>> {
        let addr = DF1Address::parse(address)?;
        let num_bytes = (size as usize) * addr.file_type.element_size();

        debug!(
            "Reading {} bytes from {} (size={})",
            num_bytes, address, size
        );

        let mut data = Vec::new();
        data.push(0xA1); // Protected typed logical read
        data.push((num_bytes & 0xFF) as u8);
        data.push(addr.file_num);
        data.push(addr.file_type as u8);
        data.push(addr.element);

        let frame = self.create_frame(1, 0, DF1_CMD_READ, &data);
        self.port.write_all(&frame).await?;

        let response = self.read_response().await?;

        if response.len() >= 6 {
            let result = response[6..].to_vec();
            debug!("Read {} bytes from {}", result.len(), address);
            Ok(result)
        } else {
            anyhow::bail!("Invalid response length: {}", response.len())
        }
    }

    pub async fn write_data(&mut self, address: &str, values: &[u8]) -> Result<()> {
        let addr = DF1Address::parse(address)?;

        debug!("Writing {} bytes to {}", values.len(), address);

        let mut data = Vec::new();
        data.push(0xA1); // Protected typed logical write
        data.push((values.len() & 0xFF) as u8);
        data.push(addr.file_num);
        data.push(addr.file_type as u8);
        data.push(addr.element);
        data.extend_from_slice(values);

        let frame = self.create_frame(1, 0, DF1_CMD_WRITE, &data);
        self.port.write_all(&frame).await?;

        self.read_response().await?;
        debug!("Write completed successfully");
        Ok(())
    }
}
