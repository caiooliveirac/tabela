// ═══════════════════════════════════════════════════════════════
// Limite de consultas por IP — proteção da aba Destino.
//
// O que ele protege: a nossa API e o fluxo de cliques do painel (cada consulta
// nova é o que dispara as rotas desenhadas via Google no navegador). O que ele
// NÃO protege: a chave de navegador em si — quem a extrai do bundle chama o
// Google direto, sem passar por aqui; isso só a restrição por referrer no
// console resolve.
//
// Duas janelas fixas por IP, as duas precisam ter saldo:
//   • curta  — segura rajada de script;
//   • horária — segura abuso paciente.
//
// Os números têm um teto humano em mente: a central de regulação inteira pode
// sair por UM IP público, e um regulador digitando dispara uma consulta a cada
// ~300 ms de tecla. Bloquear o plantão de verdade custa mais caro que qualquer
// cota do Google — na dúvida, o limite erra para cima.
//
// Estado em memória: a api é um processo só, e reiniciar zerar os contadores é
// aceitável para um limite de cortesia.
// ═══════════════════════════════════════════════════════════════
import type { Request, Response, NextFunction } from "express";

// Mesma extração do clientIp de chefiaGuard.ts — repetida aqui de propósito:
// importar chefiaGuard puxa chefiaPin, que puxa o banco, e este módulo precisa
// carregar em teste sem servidor, como os outros de lib/.
const clientIp = (req: Request): string => req.ip || req.socket.remoteAddress || "unknown";

export interface Janela {
    /** Máximo de consultas dentro da janela. */
    limite: number;
    /** Duração da janela, em ms. */
    ms: number;
}

interface Balde {
    contagem: number;
    /** Quando a janela atual abriu. */
    abreEm: number;
}

interface Baldes {
    curta: Balde;
    hora: Balde;
}

/**
 * Consome uma consulta das duas janelas. Devolve quantos segundos faltam para
 * a janela mais próxima liberar quando alguma estourou; null quando passou.
 * Puro de propósito: o teste roda sem Express e sem relógio de verdade.
 */
export function consumir(
    baldes: Baldes,
    agora: number,
    curta: Janela,
    hora: Janela,
): number | null {
    for (const [balde, janela] of [
        [baldes.curta, curta],
        [baldes.hora, hora],
    ] as const) {
        if (agora - balde.abreEm >= janela.ms) {
            balde.contagem = 0;
            balde.abreEm = agora;
        }
    }
    if (baldes.curta.contagem >= curta.limite || baldes.hora.contagem >= hora.limite) {
        const faltaCurta =
            baldes.curta.contagem >= curta.limite
                ? baldes.curta.abreEm + curta.ms - agora
                : 0;
        const faltaHora =
            baldes.hora.contagem >= hora.limite ? baldes.hora.abreEm + hora.ms - agora : 0;
        return Math.ceil(Math.max(faltaCurta, faltaHora) / 1000);
    }
    baldes.curta.contagem++;
    baldes.hora.contagem++;
    return null;
}

/**
 * Middleware de limite por IP. Responde 429 com Retry-After quando estourou.
 */
export function limitePorIp(curta: Janela, hora: Janela) {
    const porIp = new Map<string, Baldes>();

    return (req: Request, res: Response, next: NextFunction) => {
        const agora = Date.now();

        // Faxina preguiçosa: só quando o mapa cresceu além do plausível.
        // 5 mil IPs ativos numa janela de 1h não é plantão, é ataque — e aí
        // derrubar contadores velhos é exatamente o que se quer.
        if (porIp.size > 5000) {
            for (const [ip, b] of porIp) {
                if (agora - b.hora.abreEm >= hora.ms) porIp.delete(ip);
            }
        }

        const ip = clientIp(req);
        let baldes = porIp.get(ip);
        if (!baldes) {
            baldes = { curta: { contagem: 0, abreEm: agora }, hora: { contagem: 0, abreEm: agora } };
            porIp.set(ip, baldes);
        }

        const aguarde = consumir(baldes, agora, curta, hora);
        if (aguarde !== null) {
            res.setHeader("Retry-After", String(aguarde));
            return res.status(429).json({
                error: `Muitas consultas deste endereço em pouco tempo. Aguarde ${
                    aguarde >= 120 ? `${Math.ceil(aguarde / 60)} min` : `${aguarde}s`
                } e tente de novo.`,
            });
        }
        next();
    };
}
