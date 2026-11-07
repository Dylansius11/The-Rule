//! Offline rehearsal aid. One JSON request on stdin, one JSON response on stdout.
//! No chain access or signing.
use protocol::{Bucket as WireBucket, CommitPreimage, Entity, Hex32, Mode, RuleHex, commit_hash};
use rule_core::{
    Atom, Bucket, CanonicalRule, Form, Literal, Play, Previous, classify, equivalence, equivalent,
    eval, sample,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::io::{self, Read};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Row {
    play: Play,
    verdict: bool,
}

#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Advise {
        bucket: WireBucket,
        rows: Vec<Row>,
        minimum_plays: usize,
        wrong: Vec<CanonicalRule>,
        // Include pending keys as well as settled keys when applicable.
        unused_exclude_keys: Vec<String>,
        minute_digit: u8,
        previous: Option<Previous>,
        remaining_guess_budget: u8,
    },
    KnownWrong {
        row: Row,
    },
    PrepareGuess {
        game: String,
        mode: Mode,
        round: u32,
        actor: String,
        entity_id: u32,
        rule: CanonicalRule,
        salt: Hex32,
    },
    Qualify {
        seeds: Vec<String>,
        play_seconds: u64,
        guess_seconds: u64,
        investigation_seconds: u64,
    },
}

fn bucket_matches(a: Bucket, b: &WireBucket) -> bool {
    matches!(
        (a, b),
        (Bucket::Rare, WireBucket::Rare)
            | (Bucket::Mid, WireBucket::Mid)
            | (Bucket::Common, WireBucket::Common)
    )
}
fn wire_bucket(b: Bucket) -> WireBucket {
    match b {
        Bucket::Rare => WireBucket::Rare,
        Bucket::Mid => WireBucket::Mid,
        Bucket::Common => WireBucket::Common,
    }
}
fn literal(id: u8, negated: bool) -> Literal {
    Literal {
        atom: Atom::new(id).expect("daily atom"),
        negated,
    }
}
fn candidates(rows: &[Row], bucket: &WireBucket, wrong: &[CanonicalRule]) -> Vec<CanonicalRule> {
    let mut out = Vec::new();
    let mut add = |rule: CanonicalRule| {
        // Row rejection is deliberately first: classification and exact equivalence are expensive.
        if rows.iter().all(|r| eval(&rule, &r.play) == r.verdict)
            && classify(&rule).is_some_and(|b| bucket_matches(b, bucket))
            && !wrong.iter().any(|w| equivalent(&rule, w))
        {
            out.push(rule);
        }
    };
    for a in 0..90 {
        for na in [false, true] {
            add(CanonicalRule::new(Form::Single, vec![literal(a, na)]).unwrap());
            for b in a + 1..90 {
                for nb in [false, true] {
                    for form in [Form::And, Form::Or] {
                        add(
                            CanonicalRule::new(form, vec![literal(a, na), literal(b, nb)]).unwrap(),
                        );
                    }
                }
            }
        }
    }
    out
}

// Compare to one representative only, stopping at the first counterclass; this is
// linear rather than all-pairs. Exact equivalence, never a sample, gates a guess.
fn solved(rules: &[CanonicalRule]) -> bool {
    !rules.is_empty()
        && rules[1..]
            .iter()
            .all(|r| equivalence(&rules[0], r).equivalent)
}

// Stop beyond the caller's budget rather than classifying unusable alternatives.
fn classes(rules: &[CanonicalRule], budget: u8) -> Option<Vec<CanonicalRule>> {
    if rules.len() > 256 {
        return None;
    }
    let mut reps: Vec<CanonicalRule> = Vec::new();
    for rule in rules {
        if !reps.iter().any(|rep| equivalent(rep, rule)) {
            reps.push(rule.clone());
            if reps.len() > usize::from(budget) {
                return None;
            }
        }
    }
    Some(reps)
}

fn known_wrong(row: &Row) -> CanonicalRule {
    let atom = Atom::new(0).unwrap();
    let rule = CanonicalRule::new(
        Form::Single,
        vec![Literal {
            atom,
            negated: atom.evaluate(&row.play) == row.verdict,
        }],
    )
    .unwrap();
    debug_assert_ne!(eval(&rule, &row.play), row.verdict);
    rule
}

fn filler(minute: u8, previous: Option<Previous>, used: &HashSet<u64>) -> Option<Play> {
    (0..128_000).find_map(|i| {
        let index = (i * 7919) % 128_000;
        let play = Play::new((index / 128) as u16, (index % 128) as u8, minute, previous).unwrap();
        (!used.contains(&play.play_key().0)).then_some(play)
    })
}

// The signature caches only shared Atom::evaluate results. Candidate verdicts
// always use the shared eval, on a representative with the identical signature.
fn split(
    rules: &[CanonicalRule],
    minute: u8,
    previous: Option<Previous>,
    used: &HashSet<u64>,
) -> Option<(Play, usize)> {
    let mut atoms: Vec<Atom> = rules
        .iter()
        .flat_map(|r| r.literals().iter().map(|l| l.atom))
        .collect();
    atoms.sort_unstable();
    atoms.dedup();
    let mut counts: HashMap<u128, usize> = HashMap::new();
    let mut best: Option<(Play, usize, usize)> = None;
    // Broad deterministic first pass. Only exhaust the domain when the
    // candidate set is small enough to keep scoring bounded.
    let limit = if rules.len() <= 256 { 128_000 } else { 512 };
    for i in 0..limit {
        let index = (i * 7919) % 128_000;
        let play = Play::new((index / 128) as u16, (index % 128) as u8, minute, previous)
            .expect("validated context");
        if used.contains(&play.play_key().0) {
            continue;
        }
        let mut signature = 0u128;
        for (i, atom) in atoms.iter().enumerate() {
            if atom.evaluate(&play) {
                signature |= 1u128 << i;
            }
        }
        let yes = *counts
            .entry(signature)
            .or_insert_with(|| rules.iter().filter(|r| eval(r, &play)).count());
        let score = yes.min(rules.len() - yes);
        if score > 0 && best.as_ref().is_none_or(|(_, _, old)| score > *old) {
            best = Some((play, yes, score));
            if score * 3 >= rules.len() {
                return Some((play, yes));
            }
        }
    }
    best.map(|(p, yes, _)| (p, yes))
}

fn advice(
    rules: &[CanonicalRule],
    rows: usize,
    minimum_plays: usize,
    budget: u8,
    minute: u8,
    previous: Option<Previous>,
    used: &HashSet<u64>,
) -> Value {
    if rules.is_empty() {
        return json!({"status":"inconsistent", "candidates":0});
    }
    if rows >= minimum_plays && budget > 0 && solved(rules) {
        return json!({"status":"guess", "guarantee":true, "assumption":"complete accurate rows, bucket and Wrong results, and a daily sampled rule", "candidates":rules.len(), "rule":rules[0], "guess":RuleHex(rules[0].clone())});
    }
    if rows >= minimum_plays
        && budget > 0
        && let Some(reps) = classes(rules, budget)
        && !reps.is_empty()
        && reps.len() <= usize::from(budget)
    {
        let displays: Vec<_> = reps.iter().cloned().map(RuleHex).collect();
        return json!({"status":"class_guesses", "guarantee":false, "candidate_guess":reps[0], "representatives":reps, "guess_hexes":displays, "reason":"paid guesses distinguish classes; a particular first guess may be Wrong"});
    }
    if let Some((play, yes)) = split(rules, minute, previous, used) {
        return json!({"status":"play", "candidates":rules.len(), "play":play, "play_key":play.play_key().0.to_string(), "yes_candidates":yes, "no_candidates":rules.len()-yes});
    }
    if rows < minimum_plays
        && let Some(play) = filler(minute, previous, used)
    {
        return json!({"status":"play", "purpose":"reach_minimum", "play":play, "play_key":play.play_key().0.to_string(), "candidates":rules.len()});
    }
    if rules.len() > 256 {
        json!({"status":"search_limited", "candidates":rules.len(), "reason":"no split in 512 deterministic plays; full domain not searched"})
    } else {
        json!({"status":"context_wait", "candidates":rules.len(), "reason":"no split in this context or too many classes for remaining budget"})
    }
}

fn qualify_one(
    name: String,
    fixture: CanonicalRule,
    bucket: Bucket,
    play_seconds: u64,
    guess_seconds: u64,
    investigation_seconds: u64,
) -> Value {
    let mut rules = candidates(&[], &wire_bucket(bucket), &[]);
    let mut used = HashSet::new();
    let mut time = 0u64;
    let mut last: [Option<(u16, u8, u64)>; 3] = [None, None, None];
    let mut plays = [0usize; 3];
    let mut first: Option<Row> = None;
    let mut wrong_done = false;
    let mut guesses = 0usize;
    let mut ambiguities = 0usize;
    loop {
        let count: usize = plays.iter().sum();
        if rules.is_empty() || time >= investigation_seconds {
            return json!({"fixture":name,"status":"unqualified","reason":"inconsistent or deadline","plays":plays,"guesses":guesses,"waits":0,"elapsed_seconds":time,"ambiguities":ambiguities});
        }
        if count >= 50 && !wrong_done {
            let wrong = known_wrong(first.as_ref().expect("50 plays"));
            if equivalent(&wrong, &fixture)
                || time
                    .checked_add(guess_seconds)
                    .is_none_or(|end| end >= investigation_seconds)
            {
                return json!({"fixture":name,"status":"unqualified","reason":"wrong guess or deadline","plays":plays,"guesses":guesses,"elapsed_seconds":time});
            }
            rules.retain(|r| !equivalent(r, &wrong));
            wrong_done = true;
            guesses += 1;
            time += guess_seconds;
        }
        if wrong_done
            && let Some(reps) = classes(&rules, 3)
            && !reps.is_empty()
            && reps.len() <= 3
        {
            for rep in &reps {
                if time
                    .checked_add(guess_seconds)
                    .is_none_or(|end| end >= investigation_seconds)
                {
                    return json!({"fixture":name,"status":"unqualified","reason":"guess deadline","plays":plays,"guesses":guesses,"waits":0,"elapsed_seconds":time,"ambiguities":ambiguities});
                }
                guesses += 1;
                time += guess_seconds;
                if equivalent(rep, &fixture) {
                    return json!({"fixture":name,"status":"qualified","plays":plays,"guesses":guesses,"wrong_guesses":guesses-1,"waits":0,"elapsed_seconds":time,"ambiguities":ambiguities,"class_count":reps.len(),"correct_rule":rep});
                }
            }
            return json!({"fixture":name,"status":"unqualified","reason":"fixture absent from classes","plays":plays,"guesses":guesses,"elapsed_seconds":time});
        }
        if count == 75
            || time
                .checked_add(play_seconds)
                .is_none_or(|end| end >= investigation_seconds)
        {
            return json!({"fixture":name,"status":"unqualified","reason":"more than three classes, search limit, or deadline","plays":plays,"guesses":guesses,"waits":0,"elapsed_seconds":time,"ambiguities":ambiguities,"remaining_candidates":rules.len()});
        }
        let mut selected = None;
        for offset in 0..3 {
            let entity = (count + offset) % 3;
            if plays[entity] == 25 {
                continue;
            }
            let previous = last[entity].map(|(number, word_id, at)| Previous {
                number,
                word_id,
                gap_bucket: if time - at < 60 {
                    0
                } else if time - at < 3600 {
                    1
                } else {
                    2
                },
            });
            if let Some((play, _)) = split(&rules, ((time / 60) % 10) as u8, previous, &used) {
                selected = Some((entity, play));
                break;
            }
        }
        let (entity, play) = match selected {
            Some(pair) => pair,
            None => {
                ambiguities += 1;
                let entity = (0..3).find(|&e| plays[e] < 25).expect("available player");
                let previous = last[entity].map(|(number, word_id, at)| Previous {
                    number,
                    word_id,
                    gap_bucket: if time - at < 60 {
                        0
                    } else if time - at < 3600 {
                        1
                    } else {
                        2
                    },
                });
                let Some(play) = filler(((time / 60) % 10) as u8, previous, &used) else {
                    return json!({"fixture":name,"status":"unqualified","reason":"no unused play","plays":plays,"guesses":guesses,"elapsed_seconds":time});
                };
                (entity, play)
            }
        };
        let verdict = eval(&fixture, &play);
        if first.is_none() {
            first = Some(Row { play, verdict });
        }
        used.insert(play.play_key().0);
        rules.retain(|r| eval(r, &play) == verdict);
        plays[entity] += 1;
        if verdict {
            last[entity] = Some((play.number(), play.word_id(), time));
        }
        time += play_seconds;
    }
}

fn run(req: Request) -> Result<Value, String> {
    match req {
        Request::Advise {
            bucket,
            rows,
            minimum_plays,
            wrong,
            unused_exclude_keys,
            minute_digit,
            previous,
            remaining_guess_budget,
        } => {
            if remaining_guess_budget > 4 || minimum_plays > 75 {
                return Err("guess budget must be at most 4 and minimum plays at most 75".into());
            }
            Play::new(0, 0, minute_digit, previous)
                .map_err(|e| format!("invalid context: {e:?}"))?;
            let mut used: HashSet<u64> = rows.iter().map(|r| r.play.play_key().0).collect();
            if used.len() != rows.len() {
                return Err("duplicate row play key".into());
            }
            for key in unused_exclude_keys {
                let parsed: u64 = key.parse().map_err(|_| "invalid excluded play key")?;
                if parsed.to_string() != key {
                    return Err("noncanonical excluded play key".into());
                }
                used.insert(parsed);
            }
            let rules = candidates(&rows, &bucket, &wrong);
            let mut result = advice(
                &rules,
                rows.len(),
                minimum_plays,
                remaining_guess_budget,
                minute_digit,
                previous,
                &used,
            );
            if let Some(play) = filler(minute_digit, previous, &used) {
                result["filler_play"] = json!({"play":play,"play_key":play.play_key().0.to_string(),"word":rule_core::words::WORDS[usize::from(play.word_id())]});
            }
            if let Some(value) = result.get("play") {
                let play: Play =
                    serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                result["word"] = json!(rule_core::words::WORDS[usize::from(play.word_id())]);
            }
            Ok(result)
        }
        Request::KnownWrong { row } => {
            let rule = known_wrong(&row);
            Ok(
                json!({"status":"known_wrong","rule":rule,"guess":RuleHex(rule.clone()),"observed_verdict":row.verdict}),
            )
        }
        Request::PrepareGuess {
            game,
            mode,
            round,
            actor,
            entity_id,
            rule,
            salt,
        } => {
            if game.is_empty() || actor.is_empty() {
                return Err("game and actor are required".into());
            }
            let hash = commit_hash(&CommitPreimage {
                chain: "testnet",
                game: &game,
                mode,
                round,
                actor: &actor,
                entity: match mode {
                    Mode::Solo => Entity::Solo(entity_id),
                    Mode::Team => Entity::Team(entity_id),
                },
                guess: &rule,
                salt: &salt.0,
            });
            Ok(
                json!({"status":"prepared","chain":"testnet","game":game,"mode":mode,"round":round,"actor":actor,"entity_id":entity_id,"rule":rule,"guess":RuleHex(rule.clone()),"hash":hash,"salt":salt,"commit_args":{"mode":mode,"hash":hash},"reveal_args_without_commit_seq":{"mode":mode,"guess":RuleHex(rule.clone()),"salt":salt}}),
            )
        }
        Request::Qualify {
            seeds,
            play_seconds,
            guess_seconds,
            investigation_seconds,
        } => {
            if seeds.is_empty() {
                return Err("at least one deterministic seed is required".into());
            }
            if investigation_seconds == 0
                || investigation_seconds > 86_400
                || play_seconds == 0
                || guess_seconds == 0
                || play_seconds > investigation_seconds
                || guess_seconds > investigation_seconds
            {
                return Err("durations must be positive, no greater than investigation_seconds, and investigation_seconds must be at most 86400".into());
            }
            let mut results = Vec::new();
            for seed in seeds {
                let (rule, bucket) = sample(seed.as_bytes());
                results.push(qualify_one(
                    format!("seed:{seed}"),
                    rule,
                    bucket,
                    play_seconds,
                    guess_seconds,
                    investigation_seconds,
                ));
            }
            let adversarial =
                CanonicalRule::new(Form::And, vec![literal(46, true), literal(70, true)]).unwrap();
            let bucket = classify(&adversarial).ok_or("adversarial rule is not sampler-fair")?;
            results.push(qualify_one(
                "adversarial:not46-and-not70".into(),
                adversarial,
                bucket,
                play_seconds,
                guess_seconds,
                investigation_seconds,
            ));
            let passed = results.iter().all(|v| v["status"] == "qualified");
            Ok(
                json!({"status":if passed {"qualified"} else {"unqualified"}, "model":"offline_finite_model", "assumptions":{"play_seconds":play_seconds,"guess_seconds":guess_seconds,"investigation_seconds":investigation_seconds,"players":3,"attempts_per_player":25,"max_guesses":4,"clock":"simulated fixed action durations; play context at action start","limitations":"no measured wall-clock time, RPC delays, callback failures or universal solve guarantee"}, "results":results}),
            )
        }
    }
}
fn main() {
    let result = (|| -> Result<Value, String> {
        let mut input = String::new();
        io::stdin()
            .read_to_string(&mut input)
            .map_err(|e| e.to_string())?;
        let req = serde_json::from_str(&input).map_err(|e| format!("invalid request: {e}"))?;
        run(req)
    })();
    match result {
        Ok(value) => {
            let failed = value["status"] == "unqualified";
            println!("{}", value);
            if failed {
                std::process::exit(1);
            }
        }
        Err(error) => {
            println!("{}", json!({"status":"error", "error":error}));
            std::process::exit(1);
        }
    }
}
