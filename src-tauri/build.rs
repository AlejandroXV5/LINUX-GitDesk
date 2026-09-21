use std::process::Command;

fn main() {
    tauri_build::build();

    // Baked into the binary for the self-updater (src/update.rs) to compare against
    // the tip of origin/main. Empty when built outside a git checkout — the updater
    // just skips the check then.
    let sha = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=GITDESK_COMMIT={sha}");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs");
}
