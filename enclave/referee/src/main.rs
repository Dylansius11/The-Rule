use std::io::{self, Read, Write};

#[cfg(target_os = "wasi")]
#[used]
#[unsafe(link_section = "outlayer.manifest")]
static MANIFEST: [u8; include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json")).len()] =
    *include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json"));

struct Host;
impl referee::Mac for Host {
    fn mac(&self, data: &[u8]) -> Result<[u8; 32], referee::Failure> {
        #[cfg(target_os = "wasi")]
        {
            outlayer::encryption_keys::mac("rule", None, data)
                .map_err(|_| referee::Failure)?
                .try_into()
                .map_err(|_| referee::Failure)
        }
        #[cfg(not(target_os = "wasi"))]
        {
            let _ = data;
            Err(referee::Failure)
        }
    }
}

fn run() -> Result<(), referee::Failure> {
    let mut input = Vec::new();
    io::stdin()
        .lock()
        .take((referee::MAX_INPUT + 1) as u64)
        .read_to_end(&mut input)
        .map_err(|_| referee::Failure)?;
    let response = referee::execute(&input, &Host)?;
    let mut output = io::stdout().lock();
    output.write_all(&response).map_err(|_| referee::Failure)?;
    output.flush().map_err(|_| referee::Failure)
}

fn main() {
    if run().is_err() {
        std::process::exit(1);
    }
}
