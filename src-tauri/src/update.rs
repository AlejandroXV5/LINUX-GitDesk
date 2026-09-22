//! Self-update. GitHub Actions builds every push to `main` and publishes it as a
//! release (.github/workflows/build.yml). `check()` compares the commit this binary
//! was built from (baked in by build.rs) with the newest release; `install()`
//! installs that release's .deb/.rpm when GitDesk came from one, and otherwise
//! rebuilds from source like install.sh does.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const REPO_URL: &str = "https://github.com/AlejandroXV5/LINUX-GitDesk.git";
const REPO_API: &str = "https://api.github.com/repos/AlejandroXV5/LINUX-GitDesk";
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
    /// The release's title ("GitDesk 0.1.12"), for the notice.
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

/// A published release: the commit it was built from and its files.
struct Release {
    commit: String,
    title: String,
    /// (file name, download URL)
    assets: Vec<(String, String)>,
}

impl Release {
    fn asset(&self, wanted: impl Fn(&str) -> bool) -> Option<&(String, String)> {
        self.assets.iter().find(|(name, _)| wanted(name.as_str()))
    }
}

fn release_from(v: &serde_json::Value) -> Release {
    let assets = v["assets"]
        .as_array()
        .map(|a| a.iter().filter_map(|x| Some((x["name"].as_str()?.to_string(), x["browser_download_url"].as_str()?.to_string()))).collect())
        .unwrap_or_default();
    Release {
        // The workflow creates each release with `--target <sha>`.
        commit: v["target_commitish"].as_str().unwrap_or_default().to_string(),
        title: v["name"].as_str().unwrap_or_default().to_string(),
        assets,
    }
}

/// The newest release; `Ok(None)` when nothing has been published yet.
fn latest_release() -> Result<Option<Release>, String> {
    let (code, v) = crate::github::api_get(&format!("{REPO_API}/releases/latest"))?;
    match code {
        200 => Ok(Some(release_from(&v))),
        404 => Ok(None),
        _ => Err(format!("GitHub API {code}: {}", v["message"].as_str().unwrap_or("request failed"))),
    }
}

/// `Ok(None)` when already up to date, or when this binary wasn't built from a git
/// checkout (e.g. a source tarball) and so doesn't know which commit it is.
pub fn check() -> Result<Option<UpdateInfo>, String> {
    let Some(current) = current_commit() else { return Ok(None) };
    let Some(release) = latest_release()? else { return Ok(None) };
    let Some(info) = needs_update(current, &release.commit, &release.title) else { return Ok(None) };
    // Only offer the release when it's strictly ahead of this build: a feature-branch
    // or unpushed build (404, "behind", "diverged") would otherwise be downgraded.
    let (code, v) = crate::github::api_get(&format!("{REPO_API}/compare/{current}...{}", release.commit))?;
    Ok((code == 200 && v["status"].as_str() == Some("ahead")).then_some(info))
}

/// A package manager that owns the running binary — then an update is the release's
/// package of the same kind.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Package {
    Deb,
    Rpm,
}

impl Package {
    fn installed() -> Option<Package> {
        let exe = install_path();
        let owns = |program: &str, flag: &str| {
            Command::new(program).args([flag, exe.as_str()]).output().map(|o| o.status.success()).unwrap_or(false)
        };
        if owns("dpkg", "-S") {
            Some(Package::Deb)
        } else if owns("rpm", "-qf") {
            Some(Package::Rpm)
        } else {
            None
        }
    }

    /// Whether `file` is this kind of package for `arch` (as `tauri build` names them).
    fn matches(self, file: &str, arch: &str) -> bool {
        match (self, arch) {
            (Package::Deb, "x86_64") => file.ends_with("_amd64.deb"),
            (Package::Deb, "aarch64") => file.ends_with("_arm64.deb"),
            (Package::Rpm, _) => file.ends_with(&format!(".{arch}.rpm")),
            _ => false,
        }
    }
}

fn cache_dir() -> PathBuf {
    let base = std::env::var("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".cache"));
    base.join("gitdesk")
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

/// Installs the newest release: its .deb/.rpm when GitDesk was installed from one,
/// otherwise a rebuild from source. Both end in a `pkexec` password prompt (graphical
/// — no terminal needed). Runs on a blocking thread; `progress` reports each phase.
pub fn install(progress: impl Fn(&str)) -> Result<(), String> {
    if let Some(package) = Package::installed() {
        if let Some(release) = latest_release()? {
            let file = release.asset(|n| package.matches(n, std::env::consts::ARCH));
            let sums = release.asset(|n| n == "SHA256SUMS");
            if let (Some(file), Some(sums)) = (file, sums) {
                return install_package(&progress, package, file, sums);
            }
        }
        progress("La última versión no trae un paquete para este sistema: se compilará desde el código.");
    }
    install_from_source(&progress)
}

/// Downloads the release's package, checks it against SHA256SUMS and installs it with
/// the system package manager (which also pulls in any new dependency).
fn install_package(progress: &dyn Fn(&str), package: Package, file: &(String, String), sums: &(String, String)) -> Result<(), String> {
    let (name, url) = file;
    if name.contains('/') || name.starts_with('.') {
        return Err(format!("nombre de paquete inválido: {name}"));
    }
    let dir = cache_dir().join("download");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    progress(&format!("Descargando {name}…"));
    run(progress, &dir, "curl", &["-fsSL", "-o", name.as_str(), url.as_str()])?;
    run(progress, &dir, "curl", &["-fsSL", "-o", "SHA256SUMS", sums.1.as_str()])?;
    run(progress, &dir, "sha256sum", &["-c", "--ignore-missing", "SHA256SUMS"])?;

    progress("Instalando — se te pedirá tu contraseña…");
    let path = dir.join(name);
    let path = path.to_str().ok_or("ruta de descarga inválida")?;
    match package {
        Package::Deb => run(progress, &dir, "pkexec", &["apt-get", "install", "-y", path]),
        Package::Rpm => run(progress, &dir, "pkexec", &["dnf", "install", "-y", path]),
    }
}

/// Pulls the latest `main` into a checkout the updater manages itself (independent of
/// any clone the user has), rebuilds the release binary and installs it over the
/// running one.
fn install_from_source(progress: &dyn Fn(&str)) -> Result<(), String> {
    let dir = cache_dir().join("update-src");
    if dir.join(".git").is_dir() {
        progress("Descargando los últimos cambios…");
        // Checkouts made before the repo was renamed still point at the old URL.
        run(progress, &dir, "git", &["remote", "set-url", "origin", REPO_URL])?;
        run(progress, &dir, "git", &["fetch", "--depth", "1", "origin", "main"])?;
        run(progress, &dir, "git", &["reset", "--hard", "origin/main"])?;
    } else {
        progress("Clonando GitDesk…");
        let parent = dir.parent().ok_or("ruta de caché inválida")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let name = dir.file_name().and_then(|n| n.to_str()).ok_or("ruta de caché inválida")?;
        run(progress, parent, "git", &["clone", "--depth", "1", REPO_URL, name])?;
    }

    progress("Instalando dependencias…");
    run(progress, &dir, "npm", &["install"])?;

    progress("Compilando — puede tardar varios minutos…");
    run(progress, &dir, "npm", &["run", "tauri", "build", "--", "--no-bundle"])?;

    let bin = dir.join("src-tauri/target/release/gitdesk");
    if !bin.is_file() {
        return Err("la compilación no generó el binario esperado".into());
    }

    progress("Instalando — se te pedirá tu contraseña…");
    let bin = bin.to_str().ok_or("ruta de binario inválida")?;
    run(progress, &dir, "pkexec", &["install", "-m755", bin, &install_path()])?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn up_to_date_when_latest_starts_with_current(){
        assert_eq!(needs_update("abc1234", "abc1234def5678", "chore: x"), None);
        // GitHub's full 40-char sha vs. our baked short sha:
        assert_eq!(needs_update("1a2b3c4", "1a2b3c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "msg"), None);
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

    #[test]
    fn release_parsing(){
        let v = serde_json::json!({
            "name": "GitDesk 0.1.12",
            "target_commitish": "f00dbeefaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "assets": [
                { "name": "GitDesk_0.1.12_amd64.deb", "browser_download_url": "https://example.com/a.deb" },
                { "name": "GitDesk-0.1.12-1.x86_64.rpm", "browser_download_url": "https://example.com/a.rpm" },
                { "name": "SHA256SUMS", "browser_download_url": "https://example.com/sums" }
            ]
        });
        let r = release_from(&v);
        assert_eq!((r.title.as_str(), &r.commit[..7]), ("GitDesk 0.1.12", "f00dbee"));
        assert_eq!(r.asset(|n| Package::Deb.matches(n, "x86_64")).unwrap().1, "https://example.com/a.deb");
        assert_eq!(r.asset(|n| Package::Rpm.matches(n, "x86_64")).unwrap().1, "https://example.com/a.rpm");
        assert!(r.asset(|n| Package::Deb.matches(n, "aarch64")).is_none());
        assert!(r.asset(|n| n == "SHA256SUMS").is_some());
    }

    #[test]
    fn package_names_per_arch(){
        assert!(Package::Deb.matches("GitDesk_0.1.3_arm64.deb", "aarch64"));
        assert!(!Package::Deb.matches("GitDesk_0.1.3_amd64.deb", "aarch64"));
        assert!(Package::Rpm.matches("GitDesk-0.1.3-1.aarch64.rpm", "aarch64"));
        assert!(!Package::Rpm.matches("GitDesk_0.1.3_amd64.AppImage", "x86_64"));
        assert!(!Package::Deb.matches("GitDesk_0.1.3_amd64.deb", "riscv64"));
    }
}
