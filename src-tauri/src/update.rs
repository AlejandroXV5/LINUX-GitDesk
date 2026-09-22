//! Self-update: GitDesk has no release channel, just commits to `main` on GitHub.
//! `check()` compares the commit this binary was built from (baked in by build.rs)
//! against the tip of origin/main; `install()` pulls, rebuilds and reinstalls it.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const REPO_URL: &str = "https://github.com/AlejandroXV5/LINUX-GITHUB-DESKTOP.git";
const REPO_API: &str = "https://api.github.com/repos/AlejandroXV5/LINUX-GITHUB-DESKTOP";
const FALLBACK_INSTALL_PATH: &str = "/usr/local/bin/gitdesk";

/// Where the running binary lives (/usr/bin for deb/rpm, /usr/local/bin for
/// install.sh's fallback), so the restart relaunches the new build.
pub(crate) fn install_path() -> String {
    std::env::current_exe()
        .ok()
        .map(|p| p.to_string_lossy().trim_end_matches(" (deleted)").to_string())
        .filter(|p| p.starts_with("/usr/"))
        .unwrap_or_else(|| FALLBACK_INSTALL_PATH.to_string())
}

fn current_commit() -> Option<&'static str> {
    let sha = env!("GITDESK_COMMIT");
    (sha.len() >= 7).then_some(sha)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    /// First line of the latest commit's message, for the notice.
    pub message: String,
}

/// `None` when `latest_sha` is the commit already running (or too short to trust).
fn needs_update(current: &str, latest_sha: &str, message: &str) -> Option<UpdateInfo> {
    if latest_sha.len() < 7 || latest_sha.starts_with(current) {
        return None;
    }
    let message = message.lines().next().unwrap_or_default().to_string();
    Some(UpdateInfo { current: current[..current.len().min(7)].to_string(), latest: latest_sha[..7].to_string(), message })
}

/// `Ok(None)` when already up to date, when this binary wasn't built from a git
/// checkout (e.g. a source tarball), or when git has no github.com credential yet —
/// the GitDesk repo is private, so reading it needs the same token Push/Pull use.
pub fn check() -> Result<Option<UpdateInfo>, String> {
    let Some(current) = current_commit() else { return Ok(None) };
    let Some(token) = crate::github::token() else { return Ok(None) };
    let (code, body) = crate::github::http_get(&format!("{REPO_API}/commits/main"), Some(&token))?;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
    if code != 200 {
        return Err(format!("GitHub API {code}: {}", v["message"].as_str().unwrap_or("request failed")));
    }
    let latest = v["sha"].as_str().unwrap_or_default();
    let message = v["commit"]["message"].as_str().unwrap_or_default();
    let Some(info) = needs_update(current, latest, message) else { return Ok(None) };
    // Only offer main when it's strictly ahead of this build: a feature-branch or
    // unpushed build (404, "behind", "diverged") would otherwise be downgraded.
    let (code, body) = crate::github::http_get(&format!("{REPO_API}/compare/{current}...{latest}"), Some(&token))?;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
    Ok((code == 200 && v["status"].as_str() == Some("ahead")).then_some(info))
}

/// A private checkout the updater manages itself — independent of wherever (if
/// anywhere) the user has their own clone for development.
fn checkout_dir() -> PathBuf {
    let base = std::env::var("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".cache"));
    base.join("gitdesk").join("update-src")
}

fn run(progress: &dyn Fn(&str), dir: &Path, program: &str, args: &[&str]) -> Result<(), String> {
    // A GUI launched right after install.sh may not have rustup's / Node's user
    // directories in PATH yet (they come from ~/.profile at the next login).
    let home = std::env::var("HOME").unwrap_or_default();
    let path = format!("{home}/.cargo/bin:{home}/.local/bin:{}", std::env::var("PATH").unwrap_or_default());
    let out = Command::new(program)
        .env("PATH", path)
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| format!("no se pudo ejecutar {program}: {e}"))?;
    if !out.status.success() {
        let src = if out.stderr.is_empty() { &out.stdout } else { &out.stderr };
        let text = String::from_utf8_lossy(src);
        let tail: Vec<&str> = text.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(format!("{program} {} falló:\n{}", args.join(" "), tail.join("\n")));
    }
    progress(&format!("{program} {} — listo", args.join(" ")));
    Ok(())
}

/// Pulls the latest `main` into the managed checkout, rebuilds the release binary
/// and installs it over the running binary via `pkexec` (a graphical root prompt — no
/// terminal needed). Runs on a blocking thread; `progress` reports each phase.
pub fn install(progress: impl Fn(&str)) -> Result<(), String> {
    let dir = checkout_dir();
    if dir.join(".git").is_dir() {
        progress("Descargando los últimos cambios…");
        run(&progress, &dir, "git", &["fetch", "--depth", "1", "origin", "main"])?;
        run(&progress, &dir, "git", &["reset", "--hard", "origin/main"])?;
    } else {
        progress("Clonando GitDesk…");
        let parent = dir.parent().ok_or("ruta de caché inválida")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let name = dir.file_name().and_then(|n| n.to_str()).ok_or("ruta de caché inválida")?;
        run(&progress, parent, "git", &["clone", "--depth", "1", REPO_URL, name])?;
    }

    progress("Instalando dependencias…");
    run(&progress, &dir, "npm", &["install"])?;

    progress("Compilando — puede tardar varios minutos…");
    run(&progress, &dir, "npm", &["run", "tauri", "build", "--", "--no-bundle"])?;

    let bin = dir.join("src-tauri/target/release/gitdesk");
    if !bin.is_file() {
        return Err("la compilación no generó el binario esperado".into());
    }

    progress("Instalando — se te pedirá tu contraseña…");
    let bin = bin.to_str().ok_or("ruta de binario inválida")?;
    run(&progress, &dir, "pkexec", &["install", "-m755", bin, &install_path()])?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn up_to_date_when_latest_starts_with_current(){
        assert_eq!(needs_update("abc1234", "abc1234def5678", "chore: x"), None);
        // GitHub's full 40-char sha vs. our baked short sha:
        assert_eq!(needs_update("dc043d3", "dc043d3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "msg"), None);
    }

    #[test]
    fn update_available_with_first_message_line(){
        let info = needs_update("abc1234", "f00dbeefaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "feat: x\n\nlonger body").unwrap();
        assert_eq!(info.current, "abc1234");
        assert_eq!(info.latest, "f00dbee");
        assert_eq!(info.message, "feat: x");
    }

    #[test]
    fn ignores_too_short_or_empty_sha(){
        assert_eq!(needs_update("abc1234", "", "msg"), None);
        assert_eq!(needs_update("abc1234", "ab12", "msg"), None);
    }
}
