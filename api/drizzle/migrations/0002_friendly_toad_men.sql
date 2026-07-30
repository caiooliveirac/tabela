-- IF NOT EXISTS (como em 0001): a API também cria esta tabela no boot
-- (initUpaRestrictions), então rodar db:migrate depois é um no-op seguro.
CREATE TABLE IF NOT EXISTS "upa_restrictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_key" varchar(120) NOT NULL,
	"unit_name" varchar(160) NOT NULL,
	"restricted_until" timestamp with time zone NOT NULL,
	"autor" varchar(100) NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"removido_por" varchar(100),
	"removido_em" timestamp with time zone
);
