use mirai_intl_engine::{Engine, MAX_REQUEST_BYTES};
use std::io::{self, BufRead, Write};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 || args[0] != "--workers" {
        return Err("Expected --workers 1..16".into());
    }
    let workers = args[1].parse::<usize>()?;
    let engine = Engine::new(workers).map_err(|error| error.message)?;
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let mut line = Vec::new();
        loop {
            let available = input.fill_buf()?;
            if available.is_empty() {
                break;
            }
            let take = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(available.len(), |index| index + 1);
            if line.len() + take > MAX_REQUEST_BYTES + 1 {
                return Err("Native frame exceeds byte bound".into());
            }
            line.extend_from_slice(&available[..take]);
            input.consume(take);
            if line.last() == Some(&b'\n') {
                break;
            }
        }
        if line.is_empty() {
            break;
        }
        if line.pop() != Some(b'\n') {
            return Err("Native frame is truncated".into());
        }
        let request = std::str::from_utf8(&line)?;
        writeln!(output, "{}", engine.execute(request))?;
        output.flush()?;
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Mirai Intl native worker: {error}");
        std::process::exit(1);
    }
}
