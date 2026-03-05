CREATE TABLE "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" varchar(50) NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"situacao" varchar(10) NOT NULL,
	"caso" text,
	"mr" varchar(100),
	"medico" varchar(100),
	"oc" varchar(20),
	"ativo" boolean DEFAULT true NOT NULL,
	"removido_por" varchar(100),
	"removido_em" timestamp with time zone,
	"criado_por" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" varchar(50) NOT NULL,
	"tipo" varchar(30) NOT NULL,
	"nota" text,
	"autor" varchar(100) NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"removido_por" varchar(100),
	"removido_em" timestamp with time zone
);
