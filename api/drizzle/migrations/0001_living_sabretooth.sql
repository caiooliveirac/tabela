CREATE TABLE IF NOT EXISTS "chefia_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"mensagem" text NOT NULL,
	"autor" varchar(100) NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"removido_por" varchar(100),
	"removido_em" timestamp with time zone
);
