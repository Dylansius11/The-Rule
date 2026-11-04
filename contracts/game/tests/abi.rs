use std::{collections::BTreeSet, path::PathBuf};

#[test]
fn t_abi_1_export_allowlist() {
    let path = std::env::var_os("GAME_WASM").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(std::env::var_os("CARGO_TARGET_DIR").expect("set GAME_WASM or CARGO_TARGET_DIR; build with cargo near build non-reproducible-wasm --no-abi"))
            .join("near/game/game.wasm")
    });
    let bytes = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "game wasm missing at {}: {e}; run cargo near build non-reproducible-wasm --no-abi",
            path.display()
        )
    });
    let mut exports = BTreeSet::new();
    for payload in wasmparser::Parser::new(0).parse_all(&bytes) {
        if let wasmparser::Payload::ExportSection(section) = payload.unwrap() {
            for export in section {
                let export = export.unwrap();
                if export.kind == wasmparser::ExternalKind::Func {
                    exports.insert(export.name.to_owned());
                }
            }
        }
    }
    let expected = [
        "contract_source_metadata",
        "new",
        "get_params",
        "fund_compute",
        "seed_pot",
        "start_round",
        "on_begin",
        "advance",
        "get_round",
        "get_active_rounds",
        "get_next_slot",
        "deposit_credit",
        "withdraw_credit",
        "on_withdraw",
        "play",
        "on_verdict",
        "get_log",
        "get_player",
        "get_entity",
        "get_verdict",
        "get_word_list",
        "get_ledger",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(exports, expected);
}
