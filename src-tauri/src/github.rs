//! GitHub sign-in through git's own credential helpers.
//!
//! GitDesk has no OAuth app of its own. "Sign in" asks git for the github.com
//! credential (`git credential fill`): with Git Credential Manager that opens
//! GitHub's sign-in in the browser the first time and keeps the token in the
//! system keyring — the same credential Push, Pull and Clone use, in GitDesk
//! and in the terminal. "Sign out" erases it again (`git credential reject`).
//!
//! The token never leaves Rust: it is only used to read the profile from the
//! GitHub API with the system `curl` (the webview's CSP allows no network), and
//! the frontend receives the profile with the avatar inlined as a `data:` URI.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};

const API: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("GitDesk/", env!("CARGO_PKG_VERSION"));

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: String,
    /// Display name, or the login when the profile has none.
    pub name: String,
    /// Public profile email, or the account's noreply address.
    pub email: String,
    /// Profile picture as a `data:` URI; empty when it couldn't be downloaded.
    pub avatar: String,
    /// https://github.com/<login>
    pub url: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub name: String,
    pub full_name: String,
    pub private: bool,
    /// `https://github.com/<full_name>.git` — cloned with the same credential as Push/Pull.
    pub clone_url: String,
    pub description: String,
}

/// An open issue, for the "#" picker in Git Changes.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Issue {
    pub number: u64,
    pub title: String,
}

#[derive(Debug, PartialEq)]
struct Credential {
    username: String,
    password: String,
}

impl Credential {
    fn fields(&self) -> String {
        format!("username={}\npassword={}\n", self.username, self.password)
    }
}

/// The saved github.com token, if git already has one — never prompts. The updater
/// sends it for a higher API rate limit (the same credential Push/Pull already use;
/// the user doesn't need to be "signed in" to GitDesk itself).
pub(crate) fn token() -> Option<String> {
    let out = credential("fill", "", false).ok()?;
    parse_credential(&out).map(|c| c.password)
}

/// The account git already has a credential for. Never prompts; `None` when signed
/// out or when GitHub no longer accepts the saved token.
pub fn current() -> Result<Option<Account>, String> {
    let Ok(out) = credential("fill", "", false) else { return Ok(None) };
    let Some(c) = parse_credential(&out) else { return Ok(None) };
    profile(&c.password)
}

/// Ask git for the github.com credential, letting its helper run the browser sign-in
/// when it has none. A token GitHub rejects is erased and asked for once more.
pub fn sign_in() -> Result<Account, String> {
    for _ in 0..2 {
        let out = credential("fill", "", true).map_err(|e| fill_error(&e))?;
        let c = parse_credential(&out).ok_or("the credential helper returned no token")?;
        match profile(&c.password)? {
            Some(a) => {
                // Tell the helper the credential works so it keeps it (GCM stores on approve).
                let _ = credential("approve", &c.fields(), false);
                return Ok(a);
            }
            None => {
                let _ = credential("reject", &c.fields(), false);
            }
        }
    }
    Err("GitHub rejected the credential".into())
}

/// Erase the github.com credential from git's helpers. Push and Pull over HTTPS will
/// ask to sign in again — in the terminal too.
pub fn sign_out() -> Result<(), String> {
    let Ok(out) = credential("fill", "", false) else { return Ok(()) };
    let Some(c) = parse_credential(&out) else { return Ok(()) };
    credential("reject", &c.fields(), false).map(|_| ()).map_err(|e| fill_error(&e))
}

/// The signed-in user's repositories (owned, collaborator or org member), most
/// recently pushed first. Used by the Clone dialog's "Your repositories" picker.
/// Errors the same way `sign_in` does when there's no credential yet.
pub fn list_repos() -> Result<Vec<Repo>, String> {
    let out = credential("fill", "", false).map_err(|e| fill_error(&e))?;
    let c = parse_credential(&out).ok_or("the credential helper returned no token")?;
    let mut repos = Vec::new();
    for page in 1..=3 {
        let url = format!(
            "{API}/user/repos?sort=pushed&per_page=100&page={page}&affiliation=owner,collaborator,organization_member"
        );
        let (code, body) = http_get(&url, Some(&c.password))?;
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
        if code != 200 {
            return Err(format!("GitHub API {code}: {}", v["message"].as_str().unwrap_or("request failed")));
        }
        let page_repos: Vec<Repo> = v.as_array().map(|a| a.iter().map(repo_from).collect()).unwrap_or_default();
        let got = page_repos.len();
        repos.extend(page_repos);
        if got < 100 {
            break;
        }
    }
    Ok(repos)
}

fn repo_from(v: &serde_json::Value) -> Repo {
    let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    Repo { name: s("name"), full_name: s("full_name"), private: v["private"].as_bool().unwrap_or(false), clone_url: s("clone_url"), description: s("description") }
}

/// Open issues of a GitHub repository (`owner/name`), most recently updated first.
/// Public repositories need no credential; private ones use git's github.com token.
pub fn list_issues(repo: &str) -> Result<Vec<Issue>, String> {
    if !valid_repo_name(repo) {
        return Err(format!("invalid GitHub repository name: {repo}"));
    }
    let (code, v) = api_get(&format!("{API}/repos/{repo}/issues?state=open&sort=updated&per_page=100"))?;
    if code != 200 {
        return Err(format!("GitHub API {code}: {}", v["message"].as_str().unwrap_or("request failed")));
    }
    Ok(issues_from(&v))
}

/// The issues API also returns pull requests (they carry a `pull_request` key).
fn issues_from(v: &serde_json::Value) -> Vec<Issue> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter(|i| i.get("pull_request").is_none())
                .filter_map(|i| Some(Issue { number: i["number"].as_u64()?, title: i["title"].as_str().unwrap_or_default().to_string() }))
                .collect()
        })
        .unwrap_or_default()
}

/// `owner/name` made of the characters GitHub allows — it goes into an API URL.
fn valid_repo_name(s: &str) -> bool {
    let part = |p: Option<&str>| {
        p.is_some_and(|p| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)))
    };
    let mut parts = s.split('/');
    part(parts.next()) && part(parts.next()) && parts.next().is_none()
}

/// GET from the GitHub API. git's saved github.com token is sent when there is one
/// (private repositories need it; it also raises the 60 requests/hour limit) and
/// dropped if GitHub rejects it — public data doesn't need a credential.
pub(crate) fn api_get(url: &str) -> Result<(u16, serde_json::Value), String> {
    let saved = token();
    let (mut code, mut body) = http_get(url, saved.as_deref())?;
    if code == 401 && saved.is_some() {
        (code, body) = http_get(url, None)?;
    }
    Ok((code, serde_json::from_slice(&body).unwrap_or_default()))
}

/// `git credential <action>` for https://github.com; `fields` are extra `key=value`
/// lines. Returns stdout, or stderr as the error.
fn credential(action: &str, fields: &str, interactive: bool) -> Result<String, String> {
    let mut child = Command::new("git")
        .current_dir(std::env::temp_dir())
        .env("LC_ALL", "C")
        .env("LANG", "C")
        // Git itself must never prompt. An empty GIT_ASKPASS also skips SSH_ASKPASS, so
        // without a helper that can sign in, git fails instead of asking for a username.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        // The helper may open its sign-in window only when the user asked to sign in.
        .env("GCM_INTERACTIVE", if interactive { "auto" } else { "never" })
        .args(["credential", action])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run git: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let input = format!("protocol=https\nhost=github.com\n{fields}\n");
        stdin.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    } // stdin is dropped here, which closes it
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).into_owned())
    }
}

fn parse_credential(out: &str) -> Option<Credential> {
    let get = |k: &str| out.lines().find_map(|l| l.strip_prefix(k)).filter(|v| !v.is_empty()).map(str::to_string);
    Some(Credential { username: get("username=")?, password: get("password=")? })
}

/// Why `git credential fill` gave nothing: the helper's own error when it printed one
/// (e.g. the user closed GCM's window), or "no-helper" when git fell through to its
/// disabled username prompt — no configured helper can sign in to GitHub.
fn fill_error(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.contains("terminal prompts disabled"))
        .collect();
    if lines.is_empty() {
        return "no-helper".into();
    }
    lines.iter().find(|l| l.starts_with("fatal:") || l.starts_with("error:")).unwrap_or(&lines[0]).to_string()
}

/// The signed-in user; `None` when GitHub rejects the token (401).
fn profile(token: &str) -> Result<Option<Account>, String> {
    let (code, body) = http_get(&format!("{API}/user"), Some(token))?;
    if code == 401 {
        return Ok(None);
    }
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
    if code != 200 {
        return Err(format!("GitHub API {code}: {}", v["message"].as_str().unwrap_or("request failed")));
    }
    let a = account_from(&v, String::new());
    if a.login.is_empty() {
        return Err("unexpected response from the GitHub API".into());
    }
    let avatar = v["avatar_url"].as_str().map(avatar_data_uri).unwrap_or_default();
    Ok(Some(Account { avatar, ..a }))
}

fn account_from(v: &serde_json::Value, avatar: String) -> Account {
    let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    let login = s("login");
    let name = Some(s("name")).filter(|n| !n.is_empty()).unwrap_or_else(|| login.clone());
    let email = Some(s("email"))
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| format!("{}+{login}@users.noreply.github.com", v["id"].as_u64().unwrap_or(0)));
    Account { name, email, avatar, url: s("html_url"), login }
}

/// Download the avatar (64 px) and inline it: the CSP only allows `data:` images.
fn avatar_data_uri(url: &str) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    match http_get(&format!("{url}{sep}s=64"), None) {
        Ok((200, bytes)) if !bytes.is_empty() => format!("data:{};base64,{}", image_mime(&bytes), STANDARD.encode(&bytes)),
        _ => String::new(),
    }
}

fn image_mime(b: &[u8]) -> &'static str {
    if b.starts_with(b"\x89PNG") {
        "image/png"
    } else if b.starts_with(b"GIF8") {
        "image/gif"
    } else if b.len() >= 12 && &b[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

/// GET with the system `curl`. The token goes in through stdin (`--config -`) so it
/// never shows up in the process list. Returns the HTTP status and the body.
pub(crate) fn http_get(url: &str, token: Option<&str>) -> Result<(u16, Vec<u8>), String> {
    let q = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let mut config = format!("url = \"{}\"\n", q(url));
    if let Some(t) = token {
        config += &format!("header = \"Authorization: Bearer {}\"\n", q(t));
    }
    let mut child = Command::new("curl")
        .args([
            "--silent", "--show-error", "--location", "--max-time", "20",
            "--user-agent", USER_AGENT,
            "--header", "Accept: application/vnd.github+json",
            "--header", "X-GitHub-Api-Version: 2022-11-28",
            "--write-out", "\n%{http_code}",
            "--config", "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run curl: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(config.as_bytes()).map_err(|e| e.to_string())?;
    }
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    if !o.status.success() {
        let err = String::from_utf8_lossy(&o.stderr);
        return Err(err.lines().next().unwrap_or("curl failed").to_string());
    }
    split_status(&o.stdout).ok_or_else(|| "unexpected output from curl".to_string())
}

/// curl prints the body followed by `\n<status>` (from --write-out).
fn split_status(out: &[u8]) -> Option<(u16, Vec<u8>)> {
    let nl = out.iter().rposition(|&b| b == b'\n')?;
    let code = std::str::from_utf8(&out[nl + 1..]).ok()?.trim().parse().ok()?;
    Some((code, out[..nl].to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_parsing() {
        let out = "protocol=https\nhost=github.com\nusername=octo\npassword=gho_abc\n";
        assert_eq!(parse_credential(out), Some(Credential { username: "octo".into(), password: "gho_abc".into() }));
        assert_eq!(parse_credential("protocol=https\nhost=github.com\n"), None);
    }

    #[test]
    fn fill_errors() {
        let no_helper = "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n";
        assert_eq!(fill_error(no_helper), "no-helper");
        let cancelled = format!("fatal: User cancelled the authentication prompt.\n{no_helper}");
        assert_eq!(fill_error(&cancelled), "fatal: User cancelled the authentication prompt.");
    }

    #[test]
    fn curl_status_split() {
        assert_eq!(split_status(b"{\"a\":1}\n200"), Some((200, b"{\"a\":1}".to_vec())));
        assert_eq!(split_status(b"one\ntwo\n401"), Some((401, b"one\ntwo".to_vec())));
        assert_eq!(split_status(b"no status"), None);
    }

    #[test]
    fn profile_fields() {
        let v = serde_json::json!({ "login": "octocat", "id": 583231, "name": null, "email": null, "html_url": "https://github.com/octocat" });
        let a = account_from(&v, String::new());
        assert_eq!(a.name, "octocat");
        assert_eq!(a.email, "583231+octocat@users.noreply.github.com");
        let v = serde_json::json!({ "login": "octocat", "id": 1, "name": "The Octocat", "email": "octo@example.com", "html_url": "" });
        let a = account_from(&v, String::new());
        assert_eq!((a.name.as_str(), a.email.as_str()), ("The Octocat", "octo@example.com"));
    }

    #[test]
    fn avatar_mime() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n0000"), "image/png");
        assert_eq!(image_mime(b"\xff\xd8\xff\xe0"), "image/jpeg");
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
    }

    #[test]
    fn issues_skip_pull_requests() {
        let v = serde_json::json!([
            { "number": 12, "title": "Crash on start" },
            { "number": 13, "title": "Add dark icons", "pull_request": { "url": "…" } },
            { "number": 14, "title": "Spanish typos" }
        ]);
        let got: Vec<u64> = issues_from(&v).iter().map(|i| i.number).collect();
        assert_eq!(got, vec![12, 14]);
        assert!(issues_from(&serde_json::json!({ "message": "Not Found" })).is_empty());
    }

    #[test]
    fn repo_names_are_validated() {
        assert!(valid_repo_name("AlejandroXV5/LINUX-GitDesk"));
        assert!(valid_repo_name("org/my.repo_2"));
        for bad in ["", "owner", "owner/", "/name", "a/b/c", "../x", "owner/..", "o/n?x=1", "o/n#x", "o/n x"] {
            assert!(!valid_repo_name(bad), "{bad} should be rejected");
        }
    }
}
