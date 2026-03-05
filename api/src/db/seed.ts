import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { cases, intel } from "./schema.js";

const connectionString =
  process.env.DATABASE_URL || "postgres://tabela:tabela@localhost:5432/tabela";

function todayAt(h: number, m: number): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

async function seed() {
  console.log("🌱 Seeding database...");
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  // Limpar dados existentes
  await db.delete(intel);
  await db.delete(cases);

  // Casos de exemplo (mesmos do dashboard)
  await db.insert(cases).values([
    { hospitalId: "hgesf", timestamp: todayAt(7, 10), situacao: "ACEITO", caso: "POS PCR", mr: "Luiz Eduardo", medico: "Flavia", oc: "0227", criadoPor: "Sistema" },
    { hospitalId: "hge", timestamp: todayAt(10, 34), situacao: "ACEITO", caso: "TCE com sinais de HIC", mr: "Mariana", medico: "Rubem", oc: "0188", criadoPor: "Sistema" },
    { hospitalId: "hge", timestamp: todayAt(12, 0), situacao: "ACEITO", caso: "Atropelamento", mr: "Luiz Eduardo", medico: "Rubem", oc: "0476", criadoPor: "Sistema" },
    { hospitalId: "hge", timestamp: todayAt(11, 40), situacao: "ACEITO", caso: "Queda de 2,5m", mr: "Luiz Eduardo", medico: "Rubem", oc: "0376", criadoPor: "Sistema" },
    { hospitalId: "hge", timestamp: todayAt(13, 36), situacao: "ACEITO", caso: "Torção testicular", mr: "Karen", medico: "Rubem", oc: "0583", criadoPor: "Sistema" },
    { hospitalId: "hgesf", timestamp: todayAt(12, 49), situacao: "ACEITO", caso: "TSV", mr: "Luiz Eduardo", medico: "Flavia", oc: "0460", criadoPor: "Sistema" },
    { hospitalId: "hgrs", timestamp: todayAt(12, 58), situacao: "ACEITO", caso: "PAVC", mr: "Karen", medico: "Thiago", oc: "0592", criadoPor: "Sistema" },
    { hospitalId: "suburbio", timestamp: todayAt(13, 25), situacao: "ZERO", caso: "Hematemese", mr: "Luiz Eduardo", medico: "Rafael", oc: "0471", criadoPor: "Sistema" },
    { hospitalId: "hgesf", timestamp: todayAt(13, 39), situacao: "ZERO", caso: "Dor torácica", mr: "Rafaela", medico: "Tania", oc: "0439", criadoPor: "Sistema" },
    { hospitalId: "eladio", timestamp: todayAt(13, 56), situacao: "ZERO", caso: "Apoio Vitalmed bradicardia", mr: "Karen", medico: "Leonardo", oc: "", criadoPor: "Sistema" },
    { hospitalId: "metropolitano", timestamp: todayAt(14, 57), situacao: "ZERO", caso: "Crise convulsiva", mr: "Rafaela", medico: "Thierre", oc: "0311", criadoPor: "Sistema" },
    { hospitalId: "hgrs", timestamp: todayAt(15, 5), situacao: "ACEITO", caso: "AVC em janela", mr: "Karen", medico: "Tiago", oc: "0675", criadoPor: "Sistema" },
    { hospitalId: "hge", timestamp: todayAt(16, 32), situacao: "ACEITO", caso: "Fratura exposta", mr: "Karen", medico: "", oc: "0788", criadoPor: "Sistema" },
    { hospitalId: "menandro", timestamp: todayAt(16, 44), situacao: "ACEITO", caso: "DRC + possível infecção", mr: "Rafaela", medico: "Rafael", oc: "0473", criadoPor: "Sistema" },
    { hospitalId: "hge", timestamp: todayAt(16, 48), situacao: "ACEITO", caso: "PAF ombro", mr: "Mariana", medico: "Rian", oc: "", criadoPor: "Sistema" },
  ]);

  // Tutorial cases
  await db.insert(cases).values([
    { hospitalId: "hge", timestamp: todayAt(8, 0), situacao: "ACEITO", caso: "TCE leve", mr: "Karen", medico: "Dr. Silva", oc: "0100", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "hge", timestamp: todayAt(9, 30), situacao: "ACEITO", caso: "Fratura de fêmur", mr: "Mariana", medico: "Dr. Silva", oc: "0101", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "hge", timestamp: todayAt(11, 0), situacao: "ACEITO", caso: "PAF abdome", mr: "Luiz Eduardo", medico: "Dr. Costa", oc: "0102", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "hgesf", timestamp: todayAt(8, 30), situacao: "ACEITO", caso: "IAM com supra", mr: "Rafaela", medico: "Dra. Lima", oc: "0200", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "hgesf", timestamp: todayAt(10, 15), situacao: "ZERO", caso: "Dor torácica atípica", mr: "Karen", medico: "Dra. Lima", oc: "0201", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "hgrs", timestamp: todayAt(9, 0), situacao: "ACEITO", caso: "AVC isquêmico em janela", mr: "Mariana", medico: "Dr. Rocha", oc: "0300", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "metropolitano", timestamp: todayAt(10, 0), situacao: "ZERO", caso: "Status epilepticus", mr: "Rafaela", medico: "Thierre", oc: "0400", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "suburbio", timestamp: todayAt(9, 45), situacao: "ACEITO", caso: "Hematemese", mr: "Luiz Eduardo", medico: "Rafael", oc: "0500", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "menandro", timestamp: todayAt(11, 30), situacao: "ACEITO", caso: "Insuficiência renal aguda", mr: "Karen", medico: "Dr. Melo", oc: "0600", criadoPor: "Tutorial", ativo: false },
    { hospitalId: "eladio", timestamp: todayAt(10, 45), situacao: "ZERO", caso: "Crise hipertensiva", mr: "Rafaela", medico: "Dr. Nunes", oc: "0700", criadoPor: "Tutorial", ativo: false },
  ]);

  // Intel de exemplo
  await db.insert(intel).values([
    { hospitalId: "hge", tipo: "lotado", nota: "Emergência lotada, corredor cheio", autor: "Karen", timestamp: todayAt(14, 20) },
    { hospitalId: "hgesf", tipo: "sem_especialista", nota: "Sem cirurgião até 19h", autor: "Rafaela", timestamp: todayAt(13, 45) },
    { hospitalId: "metropolitano", tipo: "lotado", nota: "Só aceita prioridade máxima", autor: "Rafaela", timestamp: todayAt(15, 0) },
  ]);

  // Tutorial intel
  await db.insert(intel).values([
    { hospitalId: "hge", tipo: "lotado", nota: "Corredor lotado, tempo de espera alto", autor: "Karen", timestamp: todayAt(10, 30), ativo: false },
    { hospitalId: "hgesf", tipo: "sem_especialista", nota: "Sem cirurgião vascular até 19h", autor: "Rafaela", timestamp: todayAt(9, 0), ativo: false },
    { hospitalId: "metropolitano", tipo: "sem_recurso", nota: "Tomografia fora do ar desde 8h", autor: "Mariana", timestamp: todayAt(8, 15), ativo: false },
    { hospitalId: "suburbio", tipo: "pretendo_enviar", nota: "USA 03 com politrauma grave, ETA 20min", autor: "Luiz Eduardo", timestamp: todayAt(11, 0), ativo: false },
    { hospitalId: "menandro", tipo: "aceitando_bem", nota: "Plantonista receptivo, leitos disponíveis", autor: "Karen", timestamp: todayAt(11, 15), ativo: false },
  ]);

  console.log("✅ Seed complete");
  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
