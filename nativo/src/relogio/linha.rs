//! A linha do tempo de tudo que viaja no tempo: bolas, objetos, o laser e você.
//!
//! Cada coisa tem identidade fixa (a bola, pelo `uid`, que nunca troca — nem ao sair de um portal,
//! nem ao ser refeita depois de um salto; o objeto, pelo índice; a sua versão passada, pelo número
//! do clone) e trechos de vida no passado: o **voo** de uma bola, o **duplo** de um objeto (a versão
//! mais velha dele, que saiu do vermelho), as **emissões** de laser que saem do vermelho de uma
//! versão passada e o **trecho** da sua versão passada (que refaz a gravação).
//!
//! O que cada trecho precisa para existir é um **compromisso**: "uma bola / um objeto / o laser
//! entra neste ciano por volta de t". Ele passa por três estados: **cumprido** (aconteceu nesta
//! história), **pendente** (você voltou para antes dele e ele ainda tem de acontecer) e **quebrado**
//! (passou da hora, com a folga, sem acontecer). Quebrado não é paradoxo por si: só é se algo
//! dependia do trecho (uma **âncora**: um receptor que ele ligou, um botão que ele apertou) e nada
//! mais segura essa consequência (outro caminho). Sem dependentes, a história se ajeita: o trecho
//! some. As coisas iguais (bolas, cubos do mesmo modelo) podem fazer o papel umas das outras.
//!
//! O trecho da sua versão passada tem âncoras de caminho: ele tem de poder andar por onde andou.
//! Cada problema (algo no caminho, perigo, bola, chão que sumiu) tem uma folga de tempo antes de
//! virar paradoxo.

use bevy::prelude::*;

/// folga de tempo para uma bola ou um objeto cumprirem o compromisso (antes ou depois da hora)
pub const TOL_T: f32 = 1.0;
/// folga de tempo do laser (ele entra no ciano a cada quadro: a folga é curta)
pub const TOL_LASER: f32 = 0.25;
/// folga de lugar: entrou no mesmo ciano, perto de onde a outra entrou
pub const TOL_D: f32 = 1.5;
/// o laser entrou no ciano perto de onde entrava
pub const TOL_D_LASER: f32 = 0.5;

/// as âncoras do caminho da sua versão passada: (motivo do paradoxo, folga em segundos)
pub const CAMINHO: [(&str, f32); 5] = [
    ("algo bloqueou o caminho do seu passado", 0.1),
    ("um objeto ficou no caminho do seu passado", 0.1),
    ("o seu passado caiu num perigo", 0.05),
    ("uma bola de energia atingiu o seu passado", 0.03),
    ("o chão do seu passado sumiu", 0.35),
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Estado {
    Cumprido(f32),
    Pendente,
    Quebrado,
}

/// quem tem de entrar no ciano
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Quem {
    /// uma bola (de preferência esta, ou a do mesmo lançador; qualquer uma serve)
    Bola { uid: u64, li: Option<usize> },
    /// um objeto (de preferência este; qualquer um igual serve)
    Objeto { k: usize },
    /// o laser que a versão passada `clone` mandou ao passado
    Laser { clone: u32 },
}

/// o trecho de vida no passado que o compromisso sustenta
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Sustenta {
    Voo(usize),
    Duplo(usize),
    Emissao(usize),
}

/// "isto entra neste ciano por volta de `t`" (o que saiu do vermelho Δ s antes veio daí)
#[derive(Clone, Debug)]
pub struct Compromisso {
    pub quem: Quem,
    pub t: f32,
    pub tol: f32,
    pub onde: Vec3,
    pub estado: Estado,
    pub sustenta: Sustenta,
}

/// o que um voo de bola no passado mudou (as âncoras que dependem dele)
#[derive(Clone, Debug, Default)]
pub struct Consequencias {
    /// receptores que ele ligou
    pub pegou: Vec<usize>,
    /// entrou de novo no vermelho (virou uma saída pelo ciano mais tarde)
    pub reentrou: bool,
    /// chegou viva ao instante em que foi mandada (continua no presente)
    pub viva: bool,
}

/// trecho de vida de uma bola no passado: saiu do vermelho em `de` e voou até `ate`
#[derive(Clone, Debug)]
pub struct Voo {
    /// identidade própria (a versão mais velha da bola; a mais nova ainda está a caminho do ciano)
    pub uid: u64,
    pub de: f32,
    pub ate: f32,
    /// (instante, posição, velocidade) a cada amostra
    pub track: Vec<(f32, Vec3, Vec3)>,
    pub life: f32,
    pub cons: Consequencias,
    /// existe nesta história (um compromisso quebrado sem dependentes o apaga)
    pub ativo: bool,
    /// já está no mundo nesta passada pelo trecho (volta a false quando o tempo volta para antes)
    pub no_mundo: bool,
    /// desde quando ela existe de verdade (gravada nas fotos): a vista do ciano não a desenha de novo
    pub no_mundo_desde: Option<f32>,
}

impl Voo {
    /// onde ela estava em `t` (posição, velocidade, vida que restava), dentro do trecho
    pub fn em(&self, t: f32) -> Option<(Vec3, Vec3, f32)> {
        if self.track.is_empty() || t < self.de - 1e-6 || t >= self.ate {
            return None;
        }
        let k = self.track.iter().rposition(|s| s.0 <= t + 1e-6).unwrap_or(0);
        let a = self.track[k];
        let (p, v) = match self.track.get(k + 1) {
            Some(b) => (a.1.lerp(b.1, ((t - a.0) / (b.0 - a.0).max(1e-4)).clamp(0.0, 1.0)), a.2),
            None => (a.1, a.2),
        };
        Some((p, v, (self.life - (t - self.de)).max(0.3)))
    }
}

/// a versão mais velha de um objeto mandado ao passado: saiu do vermelho em `de` e caiu/quicou até
/// `ate` (quando a mais nova entra no ciano e ela segue sendo o objeto de verdade)
#[derive(Clone, Debug)]
pub struct Duplo {
    pub k: usize,
    pub de: f32,
    pub ate: f32,
    /// desde quando o objeto existe na história (antes disso não há o mais novo, só o duplo)
    pub nasce: f32,
    pub track: Vec<(f32, Vec3, Quat)>,
    pub ativo: bool,
    /// o objeto de verdade está escondido (só o duplo existe nesse trecho)
    pub oculto: bool,
    /// botões que ele apertou nesta história: (botão, instante)
    pub botoes: Vec<(usize, f32)>,
    /// o modelo desenhado (cópia do do objeto)
    pub mesh: Option<Entity>,
}

impl Duplo {
    /// pose em `t` (ou None fora do trecho)
    pub fn em(&self, t: f32, rate: f32) -> Option<(Vec3, Quat)> {
        if !self.ativo || self.track.is_empty() || t < self.de - 1e-6 || t >= self.ate {
            return None;
        }
        let i = (((t - self.de) / rate).floor().max(0.0) as usize).min(self.track.len() - 1);
        let a = self.track[i];
        let b = self.track[(i + 1).min(self.track.len() - 1)];
        let k = if i + 1 >= self.track.len() { 0.0 } else { ((t - a.0) / rate).clamp(0.0, 1.0) };
        Some((a.1.lerp(b.1, k), a.2.slerp(b.2, k)))
    }

    /// onde ele chega no fim do trecho
    pub fn fim(&self) -> Option<(Vec3, Quat)> {
        self.track.last().map(|s| (s.1, s.2))
    }
}

/// laser que uma versão passada sua mandou para o passado: sai de `exit` em `t`, entrou no ciano em `entrada`
#[derive(Clone, Debug)]
pub struct Emissao {
    pub clone: u32,
    pub t: f32,
    pub entrada: f32,
    pub at: Vec3,
    pub exit: Vec3,
    pub dir: Vec3,
    pub ativo: bool,
    /// receptores de laser que este feixe do passado ligou
    pub liga: Vec<usize>,
}

/// o trecho da sua versão passada (o clone que refaz a gravação), com a folga acumulada de cada
/// âncora de caminho
#[derive(Clone, Debug)]
pub struct Trecho {
    pub clone: u32,
    pub de: f32,
    pub ate: f32,
    pub ruim: [f32; 5],
}

/// bola a caminho do ciano: entrou num vermelho em `t_in` e sai pelo ciano em `t_out`
#[derive(Clone, Debug)]
pub struct Saida {
    pub uid: u64,
    pub t_in: f32,
    pub t_out: f32,
    pub pos: Vec3,
    pub vel: Vec3,
    /// centro do vermelho por onde entrou (se ele mudar de lugar, a bola se perde no tempo)
    pub key: Vec3,
    pub life: f32,
}

#[derive(Default, Clone, Debug)]
pub struct Linha {
    pub compromissos: Vec<Compromisso>,
    pub voos: Vec<Voo>,
    pub duplos: Vec<Duplo>,
    pub emissoes: Vec<Emissao>,
    pub trechos: Vec<Trecho>,
    pub saidas: Vec<Saida>,
    /// instante mais recente já visto (para saber quando o tempo voltou)
    pub visto: Option<f32>,
}

/// o que fazer com um compromisso que passou da hora sem acontecer
#[derive(Debug, PartialEq)]
pub enum Desfecho {
    /// nada dependia do trecho: ele some da história (sem paradoxo)
    Apagar(Sustenta),
    /// receptores ligados ou botões apertados só por ele: paradoxo, a não ser que outra coisa os mantenha
    Ancora { sustenta: Sustenta, receptores: Vec<usize>, botoes: Vec<(usize, f32)> },
}

impl Linha {
    /// o tempo andou até `tw` (para trás, num salto ou paradoxo): o que ainda não aconteceu nesta
    /// história volta a ser pendente, as saídas de entradas futuras somem e os voos voltam a poder
    /// entrar no mundo. Devolve true se o tempo voltou.
    pub fn ir_para(&mut self, tw: f32) -> bool {
        let back = self.visto.is_some_and(|v| tw < v - 1e-4);
        self.visto = Some(tw);
        if !back {
            return false;
        }
        for c in &mut self.compromissos {
            if matches!(c.estado, Estado::Cumprido(tc) if tc > tw + 1e-6) {
                c.estado = Estado::Pendente;
            }
        }
        self.saidas.retain(|s| s.t_in <= tw + 1e-6);
        for v in &mut self.voos {
            v.no_mundo = false;
        }
        for d in &mut self.duplos {
            d.botoes.retain(|b| b.1 <= tw + 1e-6);
        }
        for e in &mut self.emissoes {
            if e.t > tw + 1e-6 {
                e.liga.clear();
            }
        }
        true
    }

    fn pendente_perto(c: &Compromisso, pos: Vec3, tw: f32, d: f32) -> bool {
        c.estado == Estado::Pendente && (c.t - tw).abs() <= c.tol && c.onde.distance(pos) <= d
    }

    /// marca cumprido o melhor compromisso pendente entre os que `serve` aceita: primeiro os que
    /// `preferido` aponta (a mesma coisa), senão o mais perto da hora
    fn cumprir_com(&mut self, pos: Vec3, tw: f32, d: f32, serve: impl Fn(&Quem) -> bool, preferido: impl Fn(&Quem) -> bool) -> Option<usize> {
        let ok = |c: &Compromisso| Self::pendente_perto(c, pos, tw, d) && serve(&c.quem);
        let k = self.compromissos.iter().position(|c| ok(c) && preferido(&c.quem)).or_else(|| {
            self.compromissos.iter().enumerate().filter(|(_, c)| ok(c)).min_by(|a, b| (a.1.t - tw).abs().total_cmp(&(b.1.t - tw).abs())).map(|(i, _)| i)
        })?;
        self.compromissos[k].estado = Estado::Cumprido(tw);
        Some(k)
    }

    /// uma bola (`uid`, do lançador `li`) entra no ciano em `pos` no instante `tw`: cumpre um compromisso
    /// pendente? Primeiro o da mesma bola; senão qualquer um ali, na mesma hora (as bolas são iguais:
    /// outra pode fazer o papel dela). Devolve o índice do compromisso cumprido.
    pub fn cumprir(&mut self, uid: u64, li: Option<usize>, pos: Vec3, tw: f32) -> Option<usize> {
        self.cumprir_com(pos, tw, TOL_D, |q| matches!(q, Quem::Bola { .. }), |q| matches!(*q, Quem::Bola { uid: u, li: l } if u == uid || (li.is_some() && l == li)))
    }

    /// um objeto `k` entra no ciano em `pos` no instante `tw`: cumpre o compromisso de um objeto?
    /// Primeiro o dele; senão o de outro igual (`igual(j)`: o objeto j é do mesmo tipo e modelo).
    /// Devolve o índice do compromisso cumprido.
    pub fn cumprir_objeto(&mut self, k: usize, pos: Vec3, tw: f32, igual: impl Fn(usize) -> bool) -> Option<usize> {
        self.cumprir_com(pos, tw, TOL_D, |q| matches!(*q, Quem::Objeto { k: j } if j == k || igual(j)), |q| matches!(*q, Quem::Objeto { k: j } if j == k))
    }

    /// os feixes que entraram num ciano neste quadro (`entradas`): cumprem os compromissos de laser
    /// pendentes de agora (perto da hora e do lugar). Devolve quantos.
    pub fn cumprir_laser(&mut self, entradas: &[Vec3], tw: f32) -> usize {
        let mut n = 0;
        for c in &mut self.compromissos {
            if matches!(c.quem, Quem::Laser { .. }) && entradas.iter().any(|&p| Self::pendente_perto(c, p, tw, TOL_D_LASER)) {
                c.estado = Estado::Cumprido(tw);
                n += 1;
            }
        }
        n
    }

    /// compromissos pendentes que passaram da hora (com a folga): cada um vira quebrado e devolve
    /// o que fazer com o trecho que ele sustentava
    pub fn vencidos(&mut self, tw: f32) -> Vec<(usize, Desfecho)> {
        let mut out = vec![];
        for k in 0..self.compromissos.len() {
            let c = &mut self.compromissos[k];
            if c.estado != Estado::Pendente || tw <= c.t + c.tol {
                continue;
            }
            c.estado = Estado::Quebrado;
            let s = c.sustenta;
            let (receptores, botoes) = match s {
                Sustenta::Voo(v) => (self.voos[v].cons.pegou.clone(), vec![]),
                Sustenta::Duplo(d) => (vec![], self.duplos[d].botoes.clone()),
                Sustenta::Emissao(e) => (self.emissoes[e].liga.clone(), vec![]),
            };
            let d = if receptores.is_empty() && botoes.is_empty() { Desfecho::Apagar(s) } else { Desfecho::Ancora { sustenta: s, receptores, botoes } };
            out.push((k, d));
        }
        out
    }

    /// some da história o trecho (e, de um voo, o que saiu dele pelo ciano); devolve a identidade
    /// da bola do voo (0 nos outros)
    pub fn apagar(&mut self, s: Sustenta) -> u64 {
        match s {
            Sustenta::Voo(v) => {
                let v = &mut self.voos[v];
                v.ativo = false;
                let uid = v.uid;
                self.saidas.retain(|s| s.uid != uid);
                uid
            }
            Sustenta::Duplo(d) => {
                self.duplos[d].ativo = false;
                0
            }
            Sustenta::Emissao(e) => {
                self.emissoes[e].ativo = false;
                0
            }
        }
    }

    /// voos que deveriam estar no mundo em `tw` e ainda não entraram nesta passada:
    /// (voo, posição, velocidade, vida). `existe(uid)` diz se a bola já está no mundo.
    pub fn a_materializar(&mut self, tw: f32, existe: impl Fn(u64) -> bool) -> Vec<(usize, Vec3, Vec3, f32)> {
        let mut out = vec![];
        for (k, v) in self.voos.iter_mut().enumerate() {
            if !v.ativo || v.no_mundo {
                continue;
            }
            let Some((p, vel, life)) = v.em(tw) else { continue };
            v.no_mundo = true;
            if !existe(v.uid) {
                out.push((k, p, vel, life));
            }
        }
        out
    }

    /// as emissões de laser de agora (as que saem do vermelho de uma versão passada neste instante,
    /// `vivo(clone)`: a versão passada ainda existe nesta história): (emissão, saída, direção)
    pub fn emissoes_em(&self, tw: f32, janela: f32, vivo: impl Fn(u32) -> bool) -> Vec<(usize, Vec3, Vec3)> {
        let mut out: Vec<(usize, Vec3, Vec3)> = vec![];
        for (i, e) in self.emissoes.iter().enumerate() {
            if !e.ativo || (e.t - tw).abs() > janela || !vivo(e.clone) || out.iter().any(|x| x.1.distance(e.exit) < 0.2 && x.2.dot(e.dir) > 0.98) {
                continue;
            }
            out.push((i, e.exit, e.dir));
        }
        out
    }

    /// o trecho da sua versão passada `clone` neste quadro: `problemas` = as âncoras de caminho em
    /// falta agora (na ordem de CAMINHO). Cada uma acumula enquanto falta e zera quando volta; passou
    /// da folga, devolve o motivo do paradoxo.
    pub fn conferir_caminho(&mut self, clone: u32, problemas: [bool; 5], dt: f32) -> Option<&'static str> {
        let t = self.trechos.iter_mut().find(|t| t.clone == clone)?;
        let mut why = None;
        for (i, &bad) in problemas.iter().enumerate() {
            t.ruim[i] = if bad { t.ruim[i] + dt } else { 0.0 };
            if why.is_none() && t.ruim[i] > CAMINHO[i].1 {
                why = Some(CAMINHO[i].0);
            }
        }
        why
    }

    pub fn esquecer_antigos(&mut self, tw: f32, keep: f32) {
        // os trechos são referenciados pelos compromissos pelo índice: só somem quando nada aponta para eles
        self.compromissos.retain(|c| tw - c.t < keep);
        if self.compromissos.is_empty() {
            self.voos.retain(|v| tw - v.ate < keep);
            self.emissoes.retain(|e| tw - e.entrada < keep);
        }
    }
}

// ------------------------------------------------------------------ âncoras: outro caminho
/// o receptor em `pos` (raio `r`) foi alcançado por outra bola (não `uid`, nem do lançador `li`)?
/// Então ele continua ligado sem a bola que deixou a história. `bolas`: (uid, lançador, posição)
pub fn receptor_por_outra(pos: Vec3, r: f32, bolas: impl Iterator<Item = (u64, Option<usize>, Vec3)>, uid: u64, li: Option<usize>) -> bool {
    let r = r.max(0.8) + 0.4;
    bolas.into_iter().any(|(u, l, p)| u != uid && (li.is_none() || l != li) && p.distance(pos) < r)
}

/// o botão em `pos` estava apertado também por outra coisa além do objeto `k`: outro objeto em cima
/// (`objetos`: posição, sumido) ou você (`eu`, o centro do corpo)?
pub fn botao_por_outro(pos: Vec3, objetos: impl Iterator<Item = (Vec3, bool)>, k: usize, eu: Vec3) -> bool {
    let mut objetos = objetos;
    let outro = objetos.by_ref().enumerate().any(|(j, (p, gone))| j != k && !gone && p.distance(pos) < 0.9);
    let d = eu - pos;
    outro || (d.x.hypot(d.z) < 0.8 && d.y.abs() < 1.6)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn voo(de: f32, ate: f32) -> Voo {
        let track = (0..=((ate - de) * 30.0) as usize).map(|i| (de + i as f32 / 30.0, Vec3::new(i as f32 * 0.1, 0.0, 0.0), Vec3::X * 3.0)).collect();
        Voo { uid: 900, de, ate, track, life: 10.0, cons: Consequencias::default(), ativo: true, no_mundo: false, no_mundo_desde: None }
    }

    fn bola(t: f32) -> Compromisso {
        Compromisso { quem: Quem::Bola { uid: 7, li: None }, t, tol: TOL_T, onde: Vec3::ZERO, estado: Estado::Cumprido(t), sustenta: Sustenta::Voo(0) }
    }

    fn linha() -> Linha {
        let mut l = Linha::default();
        l.voos.push(voo(6.0, 10.0));
        l.compromissos.push(bola(10.0));
        l.ir_para(12.0);
        l
    }

    fn duplo(k: usize) -> Duplo {
        let track = (0..=120).map(|i| (6.0 + i as f32 / 30.0, Vec3::new(0.0, 0.3, i as f32 * 0.01), Quat::IDENTITY)).collect();
        Duplo { k, de: 6.0, ate: 10.0, nasce: 0.0, track, ativo: true, oculto: false, botoes: vec![], mesh: None }
    }

    #[test]
    fn voltar_deixa_pendente_e_a_mesma_cumpre() {
        let mut l = linha();
        assert!(l.ir_para(5.0));
        assert_eq!(l.compromissos[0].estado, Estado::Pendente);
        assert_eq!(l.cumprir(7, None, Vec3::new(0.3, 0.0, 0.0), 10.2), Some(0));
        assert_eq!(l.compromissos[0].estado, Estado::Cumprido(10.2));
    }

    #[test]
    fn outra_bola_pode_cumprir() {
        let mut l = linha();
        l.ir_para(5.0);
        assert_eq!(l.cumprir(55, Some(3), Vec3::new(0.0, 1.0, 0.0), 9.5), Some(0));
    }

    #[test]
    fn sem_voltar_no_tempo_nada_e_repeticao() {
        let mut l = linha();
        assert_eq!(l.cumprir(7, None, Vec3::ZERO, 10.3), None);
    }

    #[test]
    fn longe_ou_fora_da_hora_nao_cumpre() {
        let mut l = linha();
        l.ir_para(5.0);
        assert_eq!(l.cumprir(7, None, Vec3::new(5.0, 0.0, 0.0), 10.0), None);
        assert_eq!(l.cumprir(7, None, Vec3::ZERO, 12.0), None);
    }

    #[test]
    fn vencido_sem_dependentes_apaga_com_receptor_e_ancora() {
        let mut l = linha();
        l.ir_para(5.0);
        assert!(l.vencidos(10.5).is_empty());
        assert_eq!(l.vencidos(11.2), vec![(0, Desfecho::Apagar(Sustenta::Voo(0)))]);
        assert_eq!(l.compromissos[0].estado, Estado::Quebrado);
        let mut l = linha();
        l.voos[0].cons.pegou.push(2);
        l.ir_para(5.0);
        assert_eq!(l.vencidos(11.2), vec![(0, Desfecho::Ancora { sustenta: Sustenta::Voo(0), receptores: vec![2], botoes: vec![] })]);
    }

    #[test]
    fn materializa_uma_vez_por_passada() {
        let mut l = linha();
        l.ir_para(7.0);
        let m = l.a_materializar(7.0, |_| false);
        assert_eq!(m.len(), 1);
        assert!((m[0].1.x - 3.0).abs() < 0.11);
        assert!(l.a_materializar(7.1, |_| false).is_empty());
        l.ir_para(6.5);
        assert_eq!(l.a_materializar(6.5, |_| false).len(), 1);
        // já no mundo (veio da foto): não duplica
        l.ir_para(6.0);
        assert!(l.a_materializar(6.2, |u| u == 900).is_empty());
        // apagado: não volta
        l.ir_para(6.0);
        l.apagar(Sustenta::Voo(0));
        assert!(l.a_materializar(6.2, |_| false).is_empty());
    }

    #[test]
    fn objeto_igual_cumpre_e_duplo_com_botao_e_ancora() {
        let mut l = Linha::default();
        l.duplos.push(duplo(3));
        l.compromissos.push(Compromisso { quem: Quem::Objeto { k: 3 }, t: 10.0, tol: TOL_T, onde: Vec3::ZERO, estado: Estado::Cumprido(10.0), sustenta: Sustenta::Duplo(0) });
        l.ir_para(12.0);
        l.ir_para(5.0);
        // outro objeto que não é igual não serve; um igual serve
        assert_eq!(l.cumprir_objeto(4, Vec3::ZERO, 10.0, |_| false), None);
        assert_eq!(l.cumprir_objeto(4, Vec3::ZERO, 10.0, |j| j == 3), Some(0));
        // ninguém entra: sem botões apertados, o duplo some; com botão, é âncora
        l.ir_para(12.0);
        l.ir_para(5.0);
        assert_eq!(l.vencidos(11.5), vec![(0, Desfecho::Apagar(Sustenta::Duplo(0)))]);
        l.apagar(Sustenta::Duplo(0));
        assert!(l.duplos[0].em(7.0, 1.0 / 30.0).is_none());
        let mut l = Linha::default();
        l.duplos.push(duplo(3));
        l.compromissos.push(Compromisso { quem: Quem::Objeto { k: 3 }, t: 10.0, tol: TOL_T, onde: Vec3::ZERO, estado: Estado::Pendente, sustenta: Sustenta::Duplo(0) });
        l.duplos[0].botoes.push((1, 8.0));
        assert_eq!(l.vencidos(11.5), vec![(0, Desfecho::Ancora { sustenta: Sustenta::Duplo(0), receptores: vec![], botoes: vec![(1, 8.0)] })]);
        // voltar para antes do aperto o esquece (ele ainda não aconteceu nesta história)
        let mut l2 = Linha::default();
        l2.duplos.push(duplo(3));
        l2.duplos[0].botoes.push((1, 8.0));
        l2.ir_para(9.0);
        l2.ir_para(7.0);
        assert!(l2.duplos[0].botoes.is_empty());
    }

    #[test]
    fn laser_cumpre_perto_e_vence_rapido() {
        let mut l = Linha::default();
        l.emissoes.push(Emissao { clone: 1, t: 6.0, entrada: 10.0, at: Vec3::ZERO, exit: Vec3::X, dir: Vec3::Z, ativo: true, liga: vec![] });
        l.compromissos.push(Compromisso { quem: Quem::Laser { clone: 1 }, t: 10.0, tol: TOL_LASER, onde: Vec3::ZERO, estado: Estado::Pendente, sustenta: Sustenta::Emissao(0) });
        assert_eq!(l.cumprir_laser(&[Vec3::new(2.0, 0.0, 0.0)], 10.0), 0);
        assert_eq!(l.cumprir_laser(&[Vec3::new(0.2, 0.0, 0.0)], 10.1), 1);
        l.compromissos[0].estado = Estado::Pendente;
        assert!(l.vencidos(10.2).is_empty());
        assert_eq!(l.vencidos(10.3), vec![(0, Desfecho::Apagar(Sustenta::Emissao(0)))]);
        // emissões de agora só das versões passadas que existem
        assert_eq!(l.emissoes_em(6.0, 0.02, |_| true).len(), 1);
        assert!(l.emissoes_em(6.0, 0.02, |_| false).is_empty());
        assert!(l.emissoes_em(7.0, 0.02, |_| true).is_empty());
    }

    #[test]
    fn caminho_com_folga() {
        let mut l = Linha::default();
        l.trechos.push(Trecho { clone: 2, de: 0.0, ate: 10.0, ruim: [0.0; 5] });
        let objeto = [false, true, false, false, false];
        assert_eq!(l.conferir_caminho(2, objeto, 0.05), None);
        assert_eq!(l.conferir_caminho(2, objeto, 0.05), None);
        // voltou a ficar livre: zera
        assert_eq!(l.conferir_caminho(2, [false; 5], 0.05), None);
        assert_eq!(l.conferir_caminho(2, objeto, 0.08), None);
        assert_eq!(l.conferir_caminho(2, objeto, 0.08), Some(CAMINHO[1].0));
        // a bola tem folga curta
        assert_eq!(l.conferir_caminho(2, [false, false, false, true, false], 0.05), Some(CAMINHO[3].0));
        assert_eq!(l.conferir_caminho(9, objeto, 1.0), None);
    }

    #[test]
    fn ancoras_com_outro_caminho() {
        let b = Vec3::new(0.0, 0.0, 0.0);
        let longe = Vec3::new(10.0, 1.0, 0.0);
        // só o próprio objeto em cima: sem outro caminho
        assert!(!botao_por_outro(b, [(Vec3::new(0.1, 0.3, 0.0), false), (Vec3::new(5.0, 0.3, 0.0), false)].into_iter(), 0, longe));
        // outro cubo em cima junto
        assert!(botao_por_outro(b, [(Vec3::new(0.1, 0.3, 0.0), false), (Vec3::new(-0.3, 0.3, 0.2), false)].into_iter(), 0, longe));
        // o outro sumido não conta; você em cima conta
        assert!(!botao_por_outro(b, [(Vec3::new(0.1, 0.3, 0.0), false), (Vec3::new(-0.3, 0.3, 0.2), true)].into_iter(), 0, longe));
        assert!(botao_por_outro(b, [(Vec3::new(0.1, 0.3, 0.0), false)].into_iter(), 0, Vec3::new(0.3, 0.92, 0.1)));
        let c = Vec3::new(0.0, 1.0, 0.0);
        // só a própria bola chegou ao receptor
        assert!(!receptor_por_outra(c, 0.8, [(7, Some(1), Vec3::new(0.2, 1.0, 0.0))].into_iter(), 7, Some(1)));
        // outra bola (de outro lançador) também chegou
        assert!(receptor_por_outra(c, 0.8, [(7, Some(1), c), (9, Some(2), Vec3::new(0.5, 1.0, 0.3))].into_iter(), 7, Some(1)));
        // a do mesmo lançador (refeita) não é "outra"
        assert!(!receptor_por_outra(c, 0.8, [(9, Some(1), c)].into_iter(), 7, Some(1)));
    }
}
