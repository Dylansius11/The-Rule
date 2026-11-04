use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=RULE_GAME_ACCOUNT");
    println!("cargo:rerun-if-changed=manifest.json");
    let account = match env::var("RULE_GAME_ACCOUNT") {
        Ok(value) => value,
        Err(_) if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("wasi") => "game.testnet".into(),
        Err(_) => panic!("RULE_GAME_ACCOUNT is required for WASI builds"),
    };
    assert!(
        (2..=64).contains(&account.len())
            && account
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
            && account.ends_with(".testnet")
            && !account
                .as_bytes()
                .windows(2)
                .any(|w| b"._-".contains(&w[0]) && b"._-".contains(&w[1]))
            && account.as_bytes()[0].is_ascii_alphanumeric(),
        "invalid testnet game account"
    );
    let template = fs::read_to_string("manifest.json").expect("manifest template");
    let manifest = template.replace("<GAME_ACCOUNT_PLACEHOLDER>", &account);
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("manifest.json"),
        manifest,
    )
    .expect("write manifest");
}
