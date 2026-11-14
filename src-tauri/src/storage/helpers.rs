use rusqlite::{params, Connection};
use serde_json::Value;

pub(crate) const FSRS_W: [f64; 21] = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
pub(crate) const DAY_MS: f64 = 86_400_000.0;

pub(crate) fn current_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy as u64;
    era * 146097 + doe as i64 - 719468
}

pub(crate) fn parse_iso_timestamp(iso: &str, fallback_ms: i64) -> i64 {
    if let Ok(num) = iso.parse::<i64>() {
        return num;
    }
    let parts: Vec<&str> = iso.split('T').collect();
    if parts.len() == 2 {
        let date_parts: Vec<&str> = parts[0].split('-').collect();
        let time_str = parts[1].trim_end_matches('Z');
        let time_parts: Vec<&str> = time_str.split(':').collect();
        if date_parts.len() == 3 && time_parts.len() >= 2 {
            if let (Ok(y), Ok(m), Ok(d), Ok(h), Ok(min)) = (
                date_parts[0].parse::<i64>(),
                date_parts[1].parse::<i64>(),
                date_parts[2].parse::<i64>(),
                time_parts[0].parse::<i64>(),
                time_parts[1].parse::<i64>(),
            ) {
                let sec_parts: Vec<&str> = if time_parts.len() >= 3 {
                    time_parts[2].split('.').collect()
                } else {
                    vec!["0"]
                };
                let sec = sec_parts[0].parse::<i64>().unwrap_or(0);
                let ms = if sec_parts.len() > 1 {
                    let mut ms_str = sec_parts[1].to_string();
                    ms_str.truncate(3);
                    while ms_str.len() < 3 {
                        ms_str.push('0');
                    }
                    ms_str.parse::<i64>().unwrap_or(0)
                } else {
                    0
                };
                let days_since_1970 = days_from_civil(y, m, d);
                let total_secs = days_since_1970 * 86400 + h * 3600 + min * 60 + sec;
                return total_secs * 1000 + ms;
            }
        }
    }
    fallback_ms
}

fn fsrs_update(previous: Option<(f64, f64)>, rating: i64, elapsed_days: f64) -> (f64, f64) {
    let n = rating as usize;
    let factor = (0.9_f64).powf(-1.0 / FSRS_W[20]) - 1.0;
    if previous.is_none() {
        let stability = FSRS_W[n - 1];
        let difficulty = (FSRS_W[4] - (FSRS_W[5] * (n as f64 - 1.0)).exp() + 1.0).clamp(1.0, 10.0);
        return (stability, difficulty);
    }
    let (s, d) = previous.unwrap();
    let r = (1.0 + factor * elapsed_days / s).powf(-FSRS_W[20]);
    let next_difficulty = (FSRS_W[7] * (FSRS_W[4] - (FSRS_W[5] * 3.0).exp() + 1.0)
        + (1.0 - FSRS_W[7]) * (d + (10.0 - d) * (-FSRS_W[6] * (rating as f64 - 3.0)) / 9.0))
        .clamp(1.0, 10.0);
    let next_stability = if rating == 1 {
        let s1 = FSRS_W[11]
            * d.powf(-FSRS_W[12])
            * ((s + 1.0).powf(FSRS_W[13]) - 1.0)
            * ((1.0 - r) * FSRS_W[14]).exp();
        let s2 = s / (FSRS_W[17] * FSRS_W[18]).exp();
        s1.min(s2)
    } else {
        let hard_penalty = if rating == 2 { FSRS_W[15] } else { 1.0 };
        let easy_bonus = if rating == 4 { FSRS_W[16] } else { 1.0 };
        s * (1.0
            + (FSRS_W[8]).exp()
                * (11.0 - d)
                * s.powf(-FSRS_W[9])
                * (((1.0 - r) * FSRS_W[10]).exp() - 1.0)
                * hard_penalty
                * easy_bonus)
    };
    (next_stability.max(0.001), next_difficulty)
}

fn review_rating(
    outcome: &str,
    rung: Option<&str>,
    miss_class: Option<&str>,
    missed: &[String],
    rating: Option<i64>,
    target: &str,
) -> Option<i64> {
    if outcome == "dismissed" {
        return None;
    }
    if !missed.is_empty() {
        if missed.iter().any(|m| m == target) {
            let is_r3_plus = rung.map(|r| r >= "R3").unwrap_or(false);
            if outcome != "movedOn"
                && outcome != "surrendered"
                && !is_r3_plus
                && (miss_class == Some("execution") || miss_class == Some("careless"))
            {
                return Some(2);
            }
            return Some(1);
        }
        let is_r3_plus = rung.map(|r| r >= "R3").unwrap_or(false);
        if outcome == "movedOn" || outcome == "surrendered" || is_r3_plus {
            return Some(3);
        }
    }
    let is_r3_plus = rung.map(|r| r >= "R3").unwrap_or(false);
    if outcome == "movedOn" || outcome == "surrendered" || is_r3_plus {
        return Some(1);
    }
    if miss_class == Some("execution") || miss_class == Some("careless") {
        return Some(2);
    }
    if let Some(r) = rating {
        if (1..=4).contains(&r) {
            return Some(r);
        }
    }
    if outcome == "solved" && rung.is_none() {
        return Some(3);
    }
    Some(2)
}

pub(crate) fn derive_phase(messages: &[Value]) -> String {
    let mut phase = "probe";
    let mut probe_done_results = std::collections::HashSet::new();
    for m in messages {
        if m.get("role").and_then(|r| r.as_str()) == Some("toolResult") {
            let tool_name = m.get("toolName").and_then(|t| t.as_str());
            let is_error = m.get("isError").and_then(|e| e.as_bool()).unwrap_or(false);
            let not_ok = m
                .get("details")
                .and_then(|d| d.get("ok"))
                .and_then(|o| o.as_bool())
                == Some(false);
            if tool_name == Some("probe_done") && !is_error && !not_ok {
                if let Some(call_id) = m.get("toolCallId").and_then(|i| i.as_str()) {
                    probe_done_results.insert(call_id.to_string());
                }
            }
        }
    }

    for m in messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role == "toolResult" {
            if phase == "probe" {
                if let Some(call_id) = m.get("toolCallId").and_then(|i| i.as_str()) {
                    if probe_done_results.contains(call_id) {
                        phase = "plan";
                    }
                }
            }
        } else if role == "assistant" && phase == "plan" {
            if let Some(content) = m.get("content").and_then(|c| c.as_array()) {
                for block in content {
                    let b_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    let b_name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    if b_type == "toolCall" && (b_name == "quiz" || b_name == "explain") {
                        if let Some(node_id) = block
                            .get("arguments")
                            .and_then(|a| a.get("nodeId"))
                            .and_then(|n| n.as_str())
                        {
                            if !node_id.is_empty() {
                                phase = "teach";
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    phase.to_string()
}

pub(crate) fn has_dangling_question(messages: &[Value]) -> bool {
    const QUESTION_TOOLS: &[&str] = &["quiz", "probe", "ask_user_question", "explain", "recall"];
    for mi in (0..messages.len()).rev() {
        let m = &messages[mi];
        if m.get("role").and_then(|r| r.as_str()) != Some("assistant") {
            continue;
        }
        let stop_reason = m.get("stopReason").and_then(|s| s.as_str()).unwrap_or("");
        if stop_reason == "error" || stop_reason == "aborted" {
            continue;
        }
        let mut answered = std::collections::HashSet::new();
        for tail in &messages[mi + 1..] {
            if tail.get("role").and_then(|r| r.as_str()) == Some("toolResult") {
                if let Some(tid) = tail.get("toolCallId").and_then(|t| t.as_str()) {
                    answered.insert(tid);
                }
            }
        }
        if let Some(content) = m.get("content").and_then(|c| c.as_array()) {
            for block in content {
                if block.get("type").and_then(|t| t.as_str()) == Some("toolCall") {
                    let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    let id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                    if QUESTION_TOOLS.contains(&name) && !answered.contains(id) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    false
}

pub(crate) fn has_active_problem(messages: &[Value]) -> bool {
    let mut clean_call_ids = std::collections::HashSet::new();
    for m in messages {
        if m.get("role").and_then(|r| r.as_str()) == Some("toolResult") {
            let is_error = m.get("isError").and_then(|e| e.as_bool()).unwrap_or(false);
            if !is_error {
                if let Some(id) = m.get("toolCallId").and_then(|i| i.as_str()) {
                    clean_call_ids.insert(id.to_string());
                }
            }
        }
    }

    for m in messages.iter().rev() {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role == "custom" {
            if m.get("customType").and_then(|c| c.as_str()) == Some("problem-dismissed") {
                return false;
            }
            continue;
        }
        if role == "assistant" {
            if let Some(content) = m.get("content").and_then(|c| c.as_array()) {
                for block in content.iter().rev() {
                    if block.get("type").and_then(|t| t.as_str()) != Some("toolCall") {
                        continue;
                    }
                    let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    let id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                    if name == "conclude" {
                        if clean_call_ids.contains(id) {
                            return false;
                        }
                        continue;
                    }
                    if name == "problem" {
                        if clean_call_ids.contains(id) {
                            return true;
                        }
                        continue;
                    }
                }
            }
        }
    }
    false
}

pub(crate) fn derive_seed_rating(messages: &[Value]) -> i64 {
    let mut ratings = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role == "assistant" {
            if let Some(content) = m.get("content").and_then(|c| c.as_array()) {
                for block in content {
                    if block.get("type").and_then(|t| t.as_str()) == Some("toolCall") {
                        let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        if name == "explain" || name == "quiz" {
                            if let Some(pr) = block
                                .get("arguments")
                                .and_then(|a| a.get("priorRating"))
                                .and_then(|p| p.as_i64())
                            {
                                if (1..=4).contains(&pr) {
                                    ratings.push(pr);
                                }
                            }
                        }
                    }
                }
            }
        } else if role == "toolResult"
            || (role == "custom"
                && m.get("customType").and_then(|c| c.as_str()) == Some("lh_question_answered"))
        {
            if let Some(details) = m.get("details").and_then(|d| d.as_object()) {
                let q_type = details.get("questionType").and_then(|q| q.as_str());
                let kind = details.get("kind").and_then(|k| k.as_str());
                let is_quiz_or_check = q_type == Some("check")
                    || q_type == Some("transfer")
                    || (kind == Some("quiz") && q_type.is_none());
                if is_quiz_or_check {
                    let correct = details.get("correct").and_then(|c| c.as_bool());
                    let dont_know = details
                        .get("dontKnow")
                        .and_then(|d| d.as_bool())
                        .unwrap_or(false);
                    if correct.is_some() || dont_know {
                        let conf = details
                            .get("confidence")
                            .and_then(|c| c.as_f64())
                            .unwrap_or(50.0);
                        let r = if dont_know || correct == Some(false) {
                            1
                        } else if conf < 70.0 {
                            2
                        } else if conf >= 90.0 {
                            4
                        } else {
                            3
                        };
                        ratings.push(r);
                    }
                }
            }
        }
    }
    if ratings.is_empty() {
        return 3;
    }
    let sum: i64 = ratings.iter().sum();
    let avg = (sum as f64) / (ratings.len() as f64);
    avg.round().clamp(1.0, 4.0) as i64
}

pub(crate) struct PracticeRecordRow {
    pub(crate) chat_id: String,
    pub(crate) at_ms: i64,
    pub(crate) targets_json: String,
    pub(crate) outcome: String,
    pub(crate) rung: Option<String>,
    pub(crate) miss_class: Option<String>,
    pub(crate) missed_json: Option<String>,
    pub(crate) rating: Option<i64>,
}

pub(crate) fn extract_practice_records(
    chat_id: &str,
    messages: &[Value],
) -> Vec<PracticeRecordRow> {
    let mut clean_calls = std::collections::HashSet::new();
    for m in messages {
        if m.get("role").and_then(|r| r.as_str()) == Some("toolResult") {
            let is_error = m.get("isError").and_then(|e| e.as_bool()).unwrap_or(false);
            if !is_error {
                if let Some(id) = m.get("toolCallId").and_then(|i| i.as_str()) {
                    clean_calls.insert(id.to_string());
                }
            }
        }
    }

    struct Event {
        at: i64,
        order: usize,
        name: String,
        args: Value,
    }
    let mut events = Vec::new();
    for m in messages {
        if m.get("role").and_then(|r| r.as_str()) == Some("assistant") {
            let timestamp = m.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);
            if let Some(content) = m.get("content").and_then(|c| c.as_array()) {
                for (order, block) in content.iter().enumerate() {
                    if block.get("type").and_then(|t| t.as_str()) == Some("toolCall") {
                        let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        let id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                        if (name == "problem" || name == "conclude") && clean_calls.contains(id) {
                            let args = block.get("arguments").cloned().unwrap_or(Value::Null);
                            events.push(Event {
                                at: timestamp,
                                order,
                                name: name.to_string(),
                                args,
                            });
                        }
                    }
                }
            }
        }
    }
    events.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.order.cmp(&b.order)));

    let mut out = Vec::new();
    let mut active: Option<(Vec<String>, i64)> = None;
    for event in events {
        if event.name == "problem" {
            let targets = match event.args.get("target") {
                Some(Value::Array(arr)) => arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect(),
                Some(Value::String(s)) => vec![s.clone()],
                _ => vec![],
            };
            active = Some((targets, event.at));
            continue;
        }
        if let Some((targets, prob_at)) = active.take() {
            if targets.is_empty() {
                continue;
            }
            let outcome = event
                .args
                .get("outcome")
                .and_then(|o| o.as_str())
                .unwrap_or("");
            if ![
                "solved",
                "solvedWithHints",
                "movedOn",
                "surrendered",
                "dismissed",
            ]
            .contains(&outcome)
            {
                continue;
            }
            let rung = event
                .args
                .get("rung")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string());
            let miss_class = event
                .args
                .get("missClass")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string());
            let missed_json = event
                .args
                .get("missed")
                .map(|m| serde_json::to_string(m).unwrap_or_default());
            let rating = event.args.get("rating").and_then(|r| r.as_i64());
            let at_ms = if event.at > 0 { event.at } else { prob_at };

            out.push(PracticeRecordRow {
                chat_id: chat_id.to_string(),
                at_ms,
                targets_json: serde_json::to_string(&targets).unwrap_or_else(|_| "[]".to_string()),
                outcome: outcome.to_string(),
                rung,
                miss_class,
                missed_json,
                rating,
            });
        }
    }
    out
}

pub(crate) fn extract_transcript_text(
    messages: &[Value],
    tree: Option<&Value>,
    extractions: Option<&Value>,
) -> String {
    let mut texts = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role == "user" {
            if let Some(content) = m.get("content") {
                if let Some(s) = content.as_str() {
                    texts.push(s.to_string());
                } else if let Some(arr) = content.as_array() {
                    for part in arr {
                        if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                            if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                                texts.push(t.to_string());
                            }
                        }
                    }
                }
            }
        } else if role == "assistant" {
            if let Some(content) = m.get("content").and_then(|c| c.as_array()) {
                for part in content {
                    if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                            texts.push(t.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Some(t) = tree {
        if let Some(nodes) = t.get("nodes").and_then(|n| n.as_array()) {
            for node in nodes {
                if let Some(title) = node.get("title").and_then(|s| s.as_str()) {
                    texts.push(title.to_string());
                }
                if let Some(stmt) = node.get("statement").and_then(|s| s.as_str()) {
                    texts.push(stmt.to_string());
                }
            }
        }
    }

    if let Some(ext) = extractions {
        if let Some(runs) = ext.as_array() {
            for run in runs {
                if let Some(nodes) = run.get("nodes").and_then(|n| n.as_array()) {
                    for node in nodes {
                        if let Some(name) = node.get("name").and_then(|s| s.as_str()) {
                            texts.push(name.to_string());
                        }
                        if let Some(stmt) = node.get("statement").and_then(|s| s.as_str()) {
                            texts.push(stmt.to_string());
                        }
                    }
                }
            }
        }
    }

    texts.join(" ")
}

pub(crate) fn materialize_fsrs_cards(tx: &Connection) -> Result<(), String> {
    tx.execute(
        "DELETE FROM fsrs_cards WHERE node_id NOT IN (SELECT id FROM graph_nodes)",
        [],
    )
    .map_err(|e| format!("Failed to prune orphaned fsrs_cards: {e}"))?;

    struct NodeData {
        created_at_ms: i64,
        chat_id: String,
    }
    let mut nodes_map = std::collections::HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT id, created_at, provenance_json FROM graph_nodes ORDER BY seq ASC")
            .map_err(|e| format!("Failed to query graph_nodes: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let created_at: String = row.get(1)?;
                let prov_json: String = row.get(2)?;
                Ok((id, created_at, prov_json))
            })
            .map_err(|e| format!("Failed to read graph_nodes: {e}"))?;

        let now_ms = current_time_ms();
        for r in rows.flatten() {
            let (id, created_at, prov_json) = r;
            let prov: Value = serde_json::from_str(&prov_json).unwrap_or(Value::Array(vec![]));
            let chat_id = prov
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|item| item.get("chatId"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let created_at_ms = parse_iso_timestamp(&created_at, now_ms);
            nodes_map.insert(
                id,
                NodeData {
                    created_at_ms,
                    chat_id,
                },
            );
        }
    }

    if nodes_map.is_empty() {
        return Ok(());
    }

    let mut teach_chats = std::collections::HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT id, seed_rating FROM chats WHERE kind = 'teach'")
            .map_err(|e| format!("Failed to query chats: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let rating: i64 = row.get(1)?;
                Ok((id, rating))
            })
            .map_err(|e| format!("Failed to read chats: {e}"))?;
        for r in rows.flatten() {
            teach_chats.insert(r.0, r.1);
        }
    }

    struct CardState {
        node_id: String,
        stability: Option<f64>,
        difficulty: Option<f64>,
        last_review_ms: Option<i64>,
        reviews: i64,
        due_at_ms: f64,
        lane: String,
        seed_rating: i64,
        stage: String,
        anchor_ms: i64,
    }

    let mut cards: std::collections::HashMap<String, CardState> = std::collections::HashMap::new();
    for (node_id, node) in &nodes_map {
        let is_teach = teach_chats.is_empty()
            || teach_chats.contains_key(&node.chat_id)
            || node.chat_id.is_empty();
        if !is_teach {
            continue;
        }
        let seed_rating = teach_chats
            .get(&node.chat_id)
            .copied()
            .unwrap_or(3)
            .clamp(1, 4);
        let due_at_ms = node.created_at_ms as f64 + FSRS_W[(seed_rating - 1) as usize] * DAY_MS;
        cards.insert(
            node_id.clone(),
            CardState {
                node_id: node_id.clone(),
                stability: None,
                difficulty: None,
                last_review_ms: None,
                reviews: 0,
                due_at_ms,
                lane: "new".to_string(),
                seed_rating,
                stage: "practiced".to_string(),
                anchor_ms: node.created_at_ms,
            },
        );
    }

    struct PracticeRow {
        chat_id: String,
        at_ms: i64,
        targets: Vec<String>,
        outcome: String,
        rung: Option<String>,
        miss_class: Option<String>,
        missed: Vec<String>,
        rating: Option<i64>,
    }
    let mut records = Vec::new();
    {
        let mut stmt = tx
            .prepare(
                r#"
                SELECT chat_id, at_ms, targets_json, outcome, rung, miss_class, missed_json, rating
                FROM practice_records ORDER BY at_ms ASC
                "#,
            )
            .map_err(|e| format!("Failed to query practice_records: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let chat_id: String = row.get(0)?;
                let at_ms: i64 = row.get(1)?;
                let targets_json: String = row.get(2)?;
                let outcome: String = row.get(3)?;
                let rung: Option<String> = row.get(4)?;
                let miss_class: Option<String> = row.get(5)?;
                let missed_json: Option<String> = row.get(6)?;
                let rating: Option<i64> = row.get(7)?;
                Ok((
                    chat_id,
                    at_ms,
                    targets_json,
                    outcome,
                    rung,
                    miss_class,
                    missed_json,
                    rating,
                ))
            })
            .map_err(|e| format!("Failed to read practice_records: {e}"))?;

        for r in rows.flatten() {
            let (chat_id, at_ms, targets_json, outcome, rung, miss_class, missed_json, rating) = r;
            let targets: Vec<String> = serde_json::from_str(&targets_json).unwrap_or_default();
            let missed: Vec<String> = missed_json
                .and_then(|m| serde_json::from_str(&m).ok())
                .unwrap_or_default();
            records.push(PracticeRow {
                chat_id,
                at_ms,
                targets,
                outcome,
                rung,
                miss_class,
                missed,
                rating,
            });
        }
    }

    let mut seen = std::collections::HashSet::new();
    let retention = 0.9_f64;
    let factor = (0.9_f64).powf(-1.0 / FSRS_W[20]) - 1.0;

    for rec in records {
        for target in &rec.targets {
            let dedupe_key = format!("{}\0{}", rec.chat_id, target);
            if seen.contains(&dedupe_key) {
                continue;
            }
            seen.insert(dedupe_key);

            let card = match cards.get_mut(target) {
                Some(c) => c,
                None => continue,
            };

            let rating = match review_rating(
                &rec.outcome,
                rec.rung.as_deref(),
                rec.miss_class.as_deref(),
                &rec.missed,
                rec.rating,
                target,
            ) {
                Some(r) => r,
                None => continue,
            };

            let born_at = nodes_map
                .get(target)
                .map(|n| n.created_at_ms)
                .unwrap_or(rec.at_ms);
            let elapsed_days = match card.last_review_ms {
                None => ((rec.at_ms - born_at) as f64 / DAY_MS).max(0.0),
                Some(last) => ((rec.at_ms - last) as f64 / DAY_MS).max(0.0),
            };

            let prev = match (card.stability, card.difficulty) {
                (Some(s), Some(d)) => Some((s, d)),
                _ => None,
            };

            let (next_s, next_d) = fsrs_update(prev, rating, elapsed_days);
            let prior_stage = card.stage.clone();
            let mut stage = card.stage.clone();
            let mut anchor = card.anchor_ms;

            if rating == 1 {
                stage = "practiced".to_string();
                anchor = rec.at_ms;
            } else if rating >= 3 {
                let since = rec.at_ms - anchor;
                if since >= (7.0 * DAY_MS) as i64
                    && (prior_stage == "demonstrated" || prior_stage == "retained")
                {
                    stage = "retained".to_string();
                } else if since >= DAY_MS as i64 && prior_stage == "practiced" {
                    stage = "demonstrated".to_string();
                    anchor = rec.at_ms;
                }
            }

            let interval_days = next_s / factor * (retention.powf(-1.0 / FSRS_W[20]) - 1.0);
            card.stability = Some(next_s);
            card.difficulty = Some(next_d);
            card.last_review_ms = Some(rec.at_ms);
            card.reviews += 1;
            card.due_at_ms = rec.at_ms as f64 + interval_days * DAY_MS;
            card.lane = "review".to_string();
            card.stage = stage;
            card.anchor_ms = anchor;
        }
    }

    let mut insert_stmt = tx
        .prepare_cached(
            r#"
            INSERT OR REPLACE INTO fsrs_cards (
                node_id, stability, difficulty, last_review_ms, reviews, due_at_ms, lane, seed_rating, stage
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .map_err(|e| format!("Failed to prepare fsrs_cards insert: {e}"))?;

    for card in cards.values() {
        insert_stmt
            .execute(params![
                card.node_id,
                card.stability,
                card.difficulty,
                card.last_review_ms,
                card.reviews,
                card.due_at_ms,
                card.lane,
                card.seed_rating,
                card.stage,
            ])
            .map_err(|e| format!("Failed to insert fsrs_card {}: {e}", card.node_id))?;
    }

    Ok(())
}
