// ═══════════════════════════════════════════════════════════════
// Guarda de chefia — reusável por qualquer rota que exija PIN.
//
// Extraído de routes/chefia.ts quando a restrição de UPA passou a exigir a
// mesma autorização: alerta de chefia e restrição de UPA são duas ações da
// mesma pessoa, com o mesmo PIN, o mesmo rate limit e o mesmo bloqueio de IP.
// ═══════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import {
    chefiaPinConfigured,
    verifyChefiaPin,
    isBlocked,
    registerPinFailure,
    registerPinSuccess,
} from "./chefiaPin.js";

export function clientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Garante que a ação foi autorizada por um PIN de chefia válido.
 * Responde e retorna false se bloqueada; retorna true para prosseguir.
 */
export async function enforceChefiaPin(req: Request, res: Response, pin: string): Promise<boolean> {
    const ip = clientIp(req);

    // IP bloqueado de vez (5 erros em curto espaço) — nem tenta validar.
    if (await isBlocked(ip)) {
        res.status(403).json({
            error: "Este dispositivo foi bloqueado por tentativas de PIN. Contate o administrador.",
        });
        return false;
    }

    if (!(await chefiaPinConfigured())) {
        res.status(503).json({
            error: "PIN da chefia não configurado no servidor. Contate o administrador.",
        });
        return false;
    }

    if (!(await verifyChefiaPin(pin))) {
        await registerPinFailure(ip); // pode bloquear o IP e avisar o admin
        res.status(403).json({ error: "PIN incorreto." });
        return false;
    }

    registerPinSuccess(ip);
    return true;
}

// Nomes reservados/placeholder que não identificam uma pessoa real.
// Bloqueados no servidor para que exclusões/edições fiquem sempre atribuíveis,
// mesmo vindas de um frontend em cache ou de chamada direta à API.
const RESERVED_NAMES = ["sistema", "tutorial"];

export const realName = (label: string) =>
    z
        .string()
        .trim()
        .min(1, `${label} obrigatório`)
        .refine(
            (v) => !RESERVED_NAMES.includes(v.toLowerCase()),
            `${label} inválido (nome reservado)`
        );
