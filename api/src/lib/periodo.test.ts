import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    formatDateTime,
    fromWall,
    operationalDayStart,
    parsePeriodo,
    turnoOf,
    wallParts,
} from "./periodo.js";

describe("fromWall / wallParts (America/Sao_Paulo)", () => {
    it("converte horário de parede para UTC (-03:00)", () => {
        // 28/07/2026 07:00 em São Paulo = 10:00 UTC
        assert.equal(fromWall(2026, 7, 28, 7, 0).toISOString(), "2026-07-28T10:00:00.000Z");
    });

    it("volta de UTC para o horário de parede correto", () => {
        const p = wallParts(new Date("2026-07-29T02:30:00.000Z"));
        // 02:30 UTC ainda é 23:30 do dia anterior em São Paulo
        assert.deepEqual([p.day, p.hour, p.minute], [28, 23, 30]);
    });
});

describe("turnoOf", () => {
    const casos: Array<[string, "SD" | "SN"]> = [
        ["06:59", "SN"],
        ["07:00", "SD"],
        ["12:00", "SD"],
        ["18:59", "SD"],
        ["19:00", "SN"],
        ["23:30", "SN"],
        ["00:10", "SN"],
    ];
    for (const [hhmm, esperado] of casos) {
        it(`${hhmm} → ${esperado}`, () => {
            const [h, m] = hhmm.split(":").map(Number);
            assert.equal(turnoOf(fromWall(2026, 7, 28, h, m)), esperado);
        });
    }
});

describe("operationalDayStart — a virada das 07h", () => {
    it("às 06:59 ainda pertence ao dia operacional anterior", () => {
        const start = operationalDayStart(fromWall(2026, 7, 28, 6, 59));
        assert.equal(formatDateTime(start), "27/07 07:00");
    });

    it("às 07:01 já é o dia operacional novo", () => {
        const start = operationalDayStart(fromWall(2026, 7, 28, 7, 1));
        assert.equal(formatDateTime(start), "28/07 07:00");
    });
});

describe("parsePeriodo", () => {
    const agora = fromWall(2026, 7, 28, 15, 0);

    it("sem argumento é hoje", () => {
        const p = parsePeriodo(undefined, agora);
        assert.ok(p);
        assert.equal(p.key, "hoje");
        assert.equal(formatDateTime(p.start), "28/07 07:00");
        assert.equal(formatDateTime(p.end), "29/07 07:00");
    });

    it("ontem cobre 07:00 a 07:00 do dia anterior", () => {
        const p = parsePeriodo("ontem", agora);
        assert.ok(p);
        assert.equal(formatDateTime(p.start), "27/07 07:00");
        assert.equal(formatDateTime(p.end), "28/07 07:00");
    });

    it("7d cobre sete dias operacionais", () => {
        const p = parsePeriodo("7d", agora);
        assert.ok(p);
        assert.equal(formatDateTime(p.start), "22/07 07:00");
        assert.equal(formatDateTime(p.end), "29/07 07:00");
        assert.equal((p.end.getTime() - p.start.getTime()) / 3_600_000, 7 * 24);
    });

    it("antes das 07h, hoje ainda é o plantão que começou ontem", () => {
        const p = parsePeriodo("hoje", fromWall(2026, 7, 28, 3, 20));
        assert.ok(p);
        assert.equal(formatDateTime(p.start), "27/07 07:00");
    });

    it("argumento desconhecido devolve null", () => {
        assert.equal(parsePeriodo("banana", agora), null);
        assert.equal(parsePeriodo("30d", agora), null);
    });
});
