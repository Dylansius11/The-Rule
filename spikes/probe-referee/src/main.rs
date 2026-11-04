use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};

#[used]
#[link_section = "outlayer.manifest"]
static MANIFEST: [u8; include_bytes!("../manifest.json").len()] =
    *include_bytes!("../manifest.json");

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    op: String,
    round: u32,
    seed: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let request: Input = serde_json::from_str(&input)?;
    if request.op != "derive" {
        return Err("unknown operation".into());
    }
    let mut data = request.round.to_le_bytes().to_vec();
    data.extend_from_slice(request.seed.as_bytes());
    let mac = outlayer::encryption_keys::mac("rule", None, &data)?;
    let digest = Sha256::digest(mac);
    let mut out = io::stdout().lock();
    write!(out, "{{\"d\":\"")?;
    for byte in digest {
        write!(out, "{byte:02x}")?;
    }
    write!(out, "\"}}")?;
    out.flush()?;
    Ok(())
}
