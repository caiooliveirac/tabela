import {
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const cases = pgTable("cases", {
  id: serial("id").primaryKey(),
  hospitalId: varchar("hospital_id", { length: 50 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  situacao: varchar("situacao", { length: 10 }).notNull(), // 'ACEITO' | 'ZERO'
  caso: text("caso"),
  mr: varchar("mr", { length: 100 }),
  medico: varchar("medico", { length: 100 }),
  oc: varchar("oc", { length: 20 }),
  ativo: boolean("ativo").notNull().default(true),
  removidoPor: varchar("removido_por", { length: 100 }),
  removidoEm: timestamp("removido_em", { withTimezone: true }),
  criadoPor: varchar("criado_por", { length: 100 }).notNull(),
});

export const intel = pgTable("intel", {
  id: serial("id").primaryKey(),
  hospitalId: varchar("hospital_id", { length: 50 }).notNull(),
  tipo: varchar("tipo", { length: 30 }).notNull(), // 'lotado' | 'sem_especialista' | 'sem_recurso' | 'pretendo_enviar' | 'aceitando_bem' | 'normalizado'
  nota: text("nota"),
  autor: varchar("autor", { length: 100 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  ativo: boolean("ativo").notNull().default(true),
  removidoPor: varchar("removido_por", { length: 100 }),
  removidoEm: timestamp("removido_em", { withTimezone: true }),
});

// Restrição de UPA — decisão da chefia (autorizada por PIN) de que uma unidade
// não deve receber pacientes até um prazo. Diferente de chefia_alerts (texto
// livre), aqui o dado é estruturado: unidade + prazo. Isso é o que permite
// pintar a célula de vermelho no painel, expirar sozinha e alimentar os bots.
// A chave é a unit_key do giro de leitos (mesma usada em /tabela/upas/api).
export const upaRestrictions = pgTable("upa_restrictions", {
  id: serial("id").primaryKey(),
  unitKey: varchar("unit_key", { length: 120 }).notNull(),
  // Nome exibido no momento da restrição — congelado para que a mensagem do bot
  // e o histórico continuem legíveis mesmo se o giro renomear a unidade.
  unitName: varchar("unit_name", { length: 160 }).notNull(),
  restrictedUntil: timestamp("restricted_until", { withTimezone: true }).notNull(),
  autor: varchar("autor", { length: 100 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  ativo: boolean("ativo").notNull().default(true),
  removidoPor: varchar("removido_por", { length: 100 }),
  removidoEm: timestamp("removido_em", { withTimezone: true }),
});

export const chefiaAlerts = pgTable("chefia_alerts", {
  id: serial("id").primaryKey(),
  mensagem: text("mensagem").notNull(),
  autor: varchar("autor", { length: 100 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  ativo: boolean("ativo").notNull().default(true),
  removidoPor: varchar("removido_por", { length: 100 }),
  removidoEm: timestamp("removido_em", { withTimezone: true }),
});
