#!/usr/bin/env bash
# GitDesk — instala todo en Linux: paquetes del sistema, Node, Rust, compila la app,
# la instala y configura Git Credential Manager (el "Iniciar sesión" con GitHub).
#
#   bash install.sh        # desde la carpeta del proyecto, como tu usuario (pide sudo)
#
# Funciona con apt (Ubuntu/Debian/Mint), dnf (Fedora) y pacman (Arch). Se puede
# volver a ejecutar: lo que ya está instalado se salta.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

say(){ printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die(){ printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
# apt installs local .deb files as user _apt: copy them somewhere it can read.
apt_install_file(){ local d; d=$(mktemp -d); chmod 755 "$d"; install -m644 "$1" "$d/"; sudo apt-get install -y "$d/$(basename "$1")"; rm -rf "$d"; }

[ "$(id -u)" -ne 0 ] || die "Ejecútalo con tu usuario normal (pedirá sudo cuando haga falta), no como root."
command -v sudo >/dev/null || die "Hace falta sudo."
[ -f package.json ] && [ -d src-tauri ] || die "Ejecútalo desde la carpeta del proyecto GitDesk."

if command -v apt-get >/dev/null; then PM=apt
elif command -v dnf >/dev/null; then PM=dnf
elif command -v pacman >/dev/null; then PM=pacman
else die "Distribución no soportada (se necesita apt, dnf o pacman)."; fi

case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "Arquitectura no soportada: $(uname -m)" ;;
esac

say "Se pedirá tu contraseña para instalar paquetes del sistema"
sudo -v

# ---------------------------------------------------------------------------
say "1/6 Paquetes del sistema ($PM)"
case $PM in
  apt)
    sudo apt-get update
    sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file git pkg-config \
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libsecret-1-0 ;;
  dnf)
    sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file git pkgconf-pkg-config \
      libappindicator-gtk3-devel librsvg2-devel libsecret
    sudo dnf group install -y c-development ;;
  pacman)
    sudo pacman -S --needed --noconfirm webkit2gtk-4.1 base-devel curl wget file git openssl \
      appmenu-gtk-module libappindicator-gtk3 librsvg libsecret ;;
esac

# ---------------------------------------------------------------------------
say "2/6 Node.js (18 o superior)"
export PATH="$HOME/.local/bin:$PATH"
node_ok(){ command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if node_ok; then
  echo "Node $(node --version) ya está instalado."
else
  # Build oficial de nodejs.org (LTS 24) en ~/.local/node, con su checksum verificado.
  base=https://nodejs.org/dist/latest-v24.x
  tmp=$(mktemp -d)
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -o "node-v[0-9.]*-linux-$ARCH\.tar\.gz" "$tmp/SHASUMS256.txt" | head -1 || true)
  [ -n "$file" ] || die "No se encontró Node para linux-$ARCH en nodejs.org."
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep "  $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node" "$HOME/.local/bin"
  tar -xzf "$tmp/$file" -C "$HOME/.local/node" --strip-components=1
  for b in node npm npx; do ln -sf "$HOME/.local/node/bin/$b" "$HOME/.local/bin/$b"; done
  rm -rf "$tmp"
  echo "Node $(node --version) instalado en ~/.local/node"
fi

# ---------------------------------------------------------------------------
say "3/6 Rust"
if [ -x "$HOME/.cargo/bin/rustup" ]; then
  echo "rustup ya está instalado."
else
  # Instalador oficial (rustup.rs); el Rust de la distribución suele ser demasiado viejo.
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version

# ---------------------------------------------------------------------------
say "4/6 Compilando GitDesk (la primera vez tarda varios minutos)"
npm ci --no-audit --no-fund
case $PM in
  apt) npm run tauri build -- --bundles deb ;;
  dnf) npm run tauri build -- --bundles rpm ;;
  pacman) npm run tauri build -- --no-bundle ;;
esac

# ---------------------------------------------------------------------------
say "5/6 Instalando GitDesk"
bundle=src-tauri/target/release/bundle
sudo -v
case $PM in
  apt)
    apt_install_file "$(ls -t "$bundle"/deb/*.deb | head -1)" ;;
  dnf)
    pkg=$(ls -t "$bundle"/rpm/*.rpm | head -1)
    sudo dnf install -y "./$pkg" ;;
  pacman)
    sudo install -Dm755 src-tauri/target/release/gitdesk /usr/local/bin/gitdesk
    sudo install -Dm644 src-tauri/icons/128x128.png /usr/local/share/icons/hicolor/128x128/apps/gitdesk.png
    sudo mkdir -p /usr/local/share/applications
    sudo tee /usr/local/share/applications/gitdesk.desktop >/dev/null <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=GitDesk
Comment=A Git client for the Linux desktop
Exec=gitdesk %F
Icon=gitdesk
Categories=Development;RevisionControl;
Terminal=false
DESKTOP
    ;;
esac

# ---------------------------------------------------------------------------
say "6/6 Git Credential Manager (para \"Iniciar sesión\" con GitHub)"
if command -v git-credential-manager >/dev/null; then
  echo "Git Credential Manager ya está instalado."
else
  kind=$([ $PM = apt ] && echo deb || echo tar.gz)
  url=$(curl -fsSL https://api.github.com/repos/git-ecosystem/git-credential-manager/releases/latest \
    | grep -o "https://[^\"]*/gcm-linux-$ARCH-[0-9.]*\.$kind" | head -1 || true)
  [ -n "$url" ] || die "No se encontró Git Credential Manager para linux-$ARCH. Instálalo a mano: https://github.com/git-ecosystem/git-credential-manager/releases"
  tmp=$(mktemp -d)
  curl -fsSL "$url" -o "$tmp/gcm.$kind"
  if [ $kind = deb ]; then apt_install_file "$tmp/gcm.deb"
  else sudo tar -xzf "$tmp/gcm.tar.gz" -C /usr/local/bin; fi
  rm -rf "$tmp"
fi
git-credential-manager configure
# Guardar el token en el llavero del sistema (GNOME Keyring / KWallet), salvo que ya elegiste otro.
git config --global --get credential.credentialStore >/dev/null || git config --global credential.credentialStore secretservice
echo "credential.credentialStore = $(git config --global --get credential.credentialStore)"

say "Listo. Abre GitDesk desde el menú de aplicaciones o ejecuta: gitdesk"
