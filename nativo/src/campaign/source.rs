//! De onde vêm os arquivos da campanha original (source.js, zip.js, vpk.js): SEMPRE da cópia
//! do Portal do próprio jogador — o pacote .zip gerado com `npm run pacote` ou a pasta do jogo.
//! Nada da Valve vem junto com o jogo; o caminho escolhido fica lembrado no disco do jogador.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

pub const PACK_MARK: &str = "portal-campanha.json";

// ------------------------------------------------------------------ .zip
struct ZipEntry {
    method: u16,
    csize: u32,
    local: u32,
}

pub struct Zip {
    file: Mutex<File>,
    entries: HashMap<String, ZipEntry>,
}

impl Zip {
    /// lê só o diretório central; cada arquivo é lido sob demanda
    pub fn open(path: &Path) -> Option<Zip> {
        let mut f = File::open(path).ok()?;
        let size = f.metadata().ok()?.len();
        let tail_len = size.min(22 + 0xffff);
        let mut tail = vec![0u8; tail_len as usize];
        f.seek(SeekFrom::Start(size - tail_len)).ok()?;
        f.read_exact(&mut tail).ok()?;
        let u16_ = |b: &[u8], o: usize| u16::from_le_bytes([b[o], b[o + 1]]);
        let u32_ = |b: &[u8], o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
        let end = (0..=tail.len().saturating_sub(22)).rev().find(|&i| u32_(&tail, i) == 0x06054b50)?;
        let count = u16_(&tail, end + 10) as usize;
        let cd_size = u32_(&tail, end + 12) as usize;
        let cd_ofs = u32_(&tail, end + 16) as u64;
        let mut cd = vec![0u8; cd_size];
        f.seek(SeekFrom::Start(cd_ofs)).ok()?;
        f.read_exact(&mut cd).ok()?;
        let mut entries = HashMap::new();
        let mut p = 0;
        for _ in 0..count {
            if p + 46 > cd.len() || u32_(&cd, p) != 0x02014b50 {
                return None;
            }
            let method = u16_(&cd, p + 10);
            let csize = u32_(&cd, p + 20);
            let nlen = u16_(&cd, p + 28) as usize;
            let xlen = u16_(&cd, p + 30) as usize;
            let clen = u16_(&cd, p + 32) as usize;
            let local = u32_(&cd, p + 42);
            let name = String::from_utf8_lossy(&cd[p + 46..p + 46 + nlen]).to_lowercase();
            if !name.ends_with('/') {
                entries.insert(name, ZipEntry { method, csize, local });
            }
            p += 46 + nlen + xlen + clen;
        }
        Some(Zip { file: Mutex::new(f), entries })
    }

    pub fn has(&self, path: &str) -> bool {
        self.entries.contains_key(&path.to_lowercase())
    }

    pub fn names(&self) -> impl Iterator<Item = &String> {
        self.entries.keys()
    }

    pub fn file(&self, path: &str) -> Option<Vec<u8>> {
        let e = self.entries.get(&path.to_lowercase())?;
        let raw = {
            let mut f = self.file.lock().ok()?;
            let mut h = [0u8; 30];
            f.seek(SeekFrom::Start(e.local as u64)).ok()?;
            f.read_exact(&mut h).ok()?;
            if u32::from_le_bytes([h[0], h[1], h[2], h[3]]) != 0x04034b50 {
                return None;
            }
            let skip = u16::from_le_bytes([h[26], h[27]]) as i64 + u16::from_le_bytes([h[28], h[29]]) as i64;
            f.seek(SeekFrom::Current(skip)).ok()?;
            let mut raw = vec![0u8; e.csize as usize];
            f.read_exact(&mut raw).ok()?;
            raw
        };
        match e.method {
            0 => Some(raw),
            8 => {
                let mut out = vec![];
                flate2::read::DeflateDecoder::new(&raw[..]).read_to_end(&mut out).ok()?;
                Some(out)
            }
            _ => None,
        }
    }
}

// ------------------------------------------------------------------ pasta do Portal
/// caminhos sem diferenciar maiúsculas (os arquivos do jogo vêm do Windows)
pub struct Folder {
    root: PathBuf,
    dirs: Mutex<HashMap<PathBuf, HashMap<String, PathBuf>>>,
}

impl Folder {
    fn resolve(&self, path: &str) -> Option<PathBuf> {
        let mut at = self.root.clone();
        let mut dirs = self.dirs.lock().ok()?;
        for seg in path.to_lowercase().split(['/', '\\']).filter(|s| !s.is_empty()) {
            let list = dirs.entry(at.clone()).or_insert_with(|| {
                std::fs::read_dir(&at).map(|rd| rd.flatten().map(|e| (e.file_name().to_string_lossy().to_lowercase(), e.path())).collect()).unwrap_or_default()
            });
            at = list.get(seg)?.clone();
        }
        Some(at)
    }

    fn file(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.resolve(path)?).ok()
    }

    fn range(&self, path: &str, start: u64, len: usize) -> Option<Vec<u8>> {
        let mut f = File::open(self.resolve(path)?).ok()?;
        f.seek(SeekFrom::Start(start)).ok()?;
        let mut b = vec![0u8; len];
        f.read_exact(&mut b).ok()?;
        Some(b)
    }
}

// ------------------------------------------------------------------ VPK
struct VpkEntry {
    archive: u16,
    offset: u32,
    length: u32,
    preload_at: usize,
    preload: usize,
}

/// pacote VPK (v1/v2) da instalação (base: caminho sem "_dir.vpk", ex.: "portal/portal_pak")
pub struct Vpk {
    base: String,
    dir: Vec<u8>,
    data_start: usize,
    entries: HashMap<String, VpkEntry>,
}

impl Vpk {
    pub fn open(src: &Source, base: &str) -> Option<Vpk> {
        let d = src.file(&format!("{base}_dir.vpk"))?;
        let u16_ = |o: usize| u16::from_le_bytes([d[o], d[o + 1]]);
        let u32_ = |o: usize| u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]]);
        let header = if u32_(4) == 1 { 12 } else { 28 };
        let data_start = header + u32_(8) as usize;
        let mut pos = header;
        let mut entries = HashMap::new();
        let str_ = |pos: &mut usize| -> String {
            let mut e = *pos;
            while e < d.len() && d[e] != 0 {
                e += 1;
            }
            let s: String = d[*pos..e].iter().map(|&c| c as char).collect();
            *pos = e + 1;
            s
        };
        loop {
            let ext = str_(&mut pos);
            if ext.is_empty() {
                break;
            }
            loop {
                let dir = str_(&mut pos);
                if dir.is_empty() {
                    break;
                }
                loop {
                    let name = str_(&mut pos);
                    if name.is_empty() {
                        break;
                    }
                    let preload = u16_(pos + 4) as usize;
                    let e = VpkEntry { archive: u16_(pos + 6), offset: u32_(pos + 8), length: u32_(pos + 12), preload_at: pos + 18, preload };
                    pos += 18 + preload;
                    let full = format!("{}{}{}", if dir == " " { String::new() } else { format!("{dir}/") }, name, if ext == " " { String::new() } else { format!(".{ext}") }).to_lowercase();
                    entries.insert(full, e);
                }
            }
        }
        Some(Vpk { base: base.into(), dir: d, data_start, entries })
    }

    pub fn has(&self, path: &str) -> bool {
        self.entries.contains_key(&path.to_lowercase().replace('\\', "/"))
    }

    pub fn read(&self, src: &Source, path: &str) -> Option<Vec<u8>> {
        let e = self.entries.get(&path.to_lowercase().replace('\\', "/"))?;
        let mut out = self.dir[e.preload_at..e.preload_at + e.preload].to_vec();
        if e.length > 0 {
            if e.archive == 0x7fff {
                let s = self.data_start + e.offset as usize;
                out.extend_from_slice(&self.dir[s..s + e.length as usize]);
            } else {
                out.extend(src.range(&format!("{}_{:03}.vpk", self.base, e.archive), e.offset as u64, e.length as usize)?);
            }
        }
        Some(out)
    }
}

// ------------------------------------------------------------------ origem
pub enum Source {
    Zip(Zip),
    Folder(Folder),
}

impl Source {
    /// pacote .zip da campanha ou a pasta do Portal (ou uma acima dela: "common")
    pub fn open(path: &Path) -> Option<Source> {
        if path.is_file() {
            let z = Zip::open(path)?;
            return z.has(PACK_MARK).then_some(Source::Zip(z));
        }
        for root in [path.to_path_buf(), path.join("Portal"), path.join("portal")] {
            let f = Folder { root, dirs: Mutex::new(HashMap::new()) };
            if f.resolve("portal/gameinfo.txt").is_some() {
                return Some(Source::Folder(f));
            }
        }
        None
    }

    pub fn file(&self, path: &str) -> Option<Vec<u8>> {
        match self {
            Source::Zip(z) => z.file(path),
            Source::Folder(f) => f.file(path),
        }
    }

    pub fn range(&self, path: &str, start: u64, len: usize) -> Option<Vec<u8>> {
        match self {
            Source::Zip(z) => z.file(path).and_then(|b| b.get(start as usize..start as usize + len).map(|s| s.to_vec())),
            Source::Folder(f) => f.range(path, start, len),
        }
    }

    pub fn is_pack(&self) -> bool {
        matches!(self, Source::Zip(_))
    }
}

/// conteúdo de dentro do pacote do jogo (sons, cenas, scripts, modelos): a pasta "pak/" do .zip
/// ou o VPK da instalação (com o do Half-Life 2 para os modelos de props_c17…)
pub struct Content {
    pak: Option<Vpk>,
    hl2: Option<Vpk>,
}

impl Content {
    pub fn has(&self, src: &Source, p: &str) -> bool {
        match src {
            Source::Zip(z) => z.has(&format!("pak/{p}")),
            Source::Folder(_) => self.pak.as_ref().is_some_and(|v| v.has(p)) || self.hl2.as_ref().is_some_and(|v| v.has(p)),
        }
    }

    pub fn read(&self, src: &Source, p: &str) -> Option<Vec<u8>> {
        match src {
            Source::Zip(z) => z.file(&format!("pak/{p}")),
            Source::Folder(_) => {
                if let Some(v) = self.pak.as_ref().filter(|v| v.has(p)) {
                    return v.read(src, p);
                }
                self.hl2.as_ref().filter(|v| v.has(p)).and_then(|v| v.read(src, p))
            }
        }
    }
}

pub struct Campaign {
    pub src: Source,
    pub content: Content,
    pub path: PathBuf,
}

impl Campaign {
    pub fn read(&self, p: &str) -> Option<Vec<u8>> {
        self.content.read(&self.src, p)
    }
    pub fn has(&self, p: &str) -> bool {
        self.content.has(&self.src, p)
    }
}

static CAMPAIGN: OnceLock<Mutex<Option<&'static Campaign>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<&'static Campaign>> {
    CAMPAIGN.get_or_init(|| Mutex::new(None))
}

fn remembered_file() -> PathBuf {
    crate::menu::data_dir().join("campanha.txt")
}

/// usa este pacote/pasta (e lembra a escolha); false se não for o pacote nem a pasta do Portal
pub fn use_path(path: &Path, remember: bool) -> bool {
    let Some(src) = Source::open(path) else { return false };
    let content = match &src {
        Source::Zip(_) => Content { pak: None, hl2: None },
        Source::Folder(_) => Content { pak: Vpk::open(&src, "portal/portal_pak"), hl2: Vpk::open(&src, "hl2/hl2_misc") },
    };
    let c: &'static Campaign = Box::leak(Box::new(Campaign { src, content, path: path.to_path_buf() }));
    *slot().lock().unwrap() = Some(c);
    if remember && std::env::var("PORTAL3_MUTE").is_err() {
        let _ = std::fs::create_dir_all(crate::menu::data_dir());
        let _ = std::fs::write(remembered_file(), path.to_string_lossy().as_bytes());
    }
    true
}

/// a origem já escolhida: a variável PORTAL3_CAMPANHA, a escolha lembrada ou nenhuma
pub fn get() -> Option<&'static Campaign> {
    if let Some(c) = *slot().lock().unwrap() {
        return Some(c);
    }
    let env = std::env::var("PORTAL3_CAMPANHA").ok().map(PathBuf::from);
    let saved = std::fs::read_to_string(remembered_file()).ok().map(|s| PathBuf::from(s.trim()));
    for p in env.into_iter().chain(saved) {
        if use_path(&p, false) {
            return *slot().lock().unwrap();
        }
    }
    None
}

/// esquece a escolha (para trocar de pacote/pasta)
pub fn forget() {
    *slot().lock().unwrap() = None;
    let _ = std::fs::remove_file(remembered_file());
}
