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

export const chefiaAlerts = pgTable("chefia_alerts", {
  id: serial("id").primaryKey(),
  mensagem: text("mensagem").notNull(),
  autor: varchar("autor", { length: 100 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  ativo: boolean("ativo").notNull().default(true),
  removidoPor: varchar("removido_por", { length: 100 }),
  removidoEm: timestamp("removido_em", { withTimezone: true }),
});
