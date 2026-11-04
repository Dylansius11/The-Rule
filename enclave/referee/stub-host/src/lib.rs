wit_bindgen::generate!({ path: "../wit", world: "stub", generate_all });

use exports::outlayer::encryption_keys::api::Guest;
use sha2::{Digest, Sha256};

struct Stub;
impl Guest for Stub {
    fn mac(path: String, vault: Option<String>, data: Vec<u8>) -> Result<Vec<u8>, String> {
        if path != "rule" || vault.is_some() || data.len() > 262_144 {
            return Err("invalid test invocation".into());
        }
        let mut hash = Sha256::new();
        hash.update(b"test-only-stub-key");
        hash.update(data);
        Ok(hash.finalize().to_vec())
    }
    fn encrypt(_: String, _: Option<String>, _: Vec<u8>, _: Vec<u8>) -> Result<Vec<u8>, String> {
        Err("unsupported".into())
    }
    fn decrypt(_: String, _: Option<String>, _: Vec<u8>, _: Vec<u8>) -> Result<Vec<u8>, String> {
        Err("unsupported".into())
    }
}
export!(Stub);
