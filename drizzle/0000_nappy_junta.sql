CREATE TABLE "booking_logs" (
	"booking_id" varchar(50) PRIMARY KEY NOT NULL,
	"customer_id" varchar(50),
	"vehicle_id" varchar(50),
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"insurance_option" varchar(50) NOT NULL,
	"deposit_amount" numeric(10, 2) NOT NULL,
	"discount_code" varchar(50),
	"seasonal_multiplier" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"customer_id" varchar(50) PRIMARY KEY NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"birth_date" date NOT NULL,
	"license_number" varchar(100) NOT NULL,
	"license_issue_date" date NOT NULL,
	"license_exp_date" date NOT NULL,
	"risk_category" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_catalog" (
	"vehicle_id" varchar(50) PRIMARY KEY NOT NULL,
	"make" varchar(100) NOT NULL,
	"model" varchar(100) NOT NULL,
	"year" integer NOT NULL,
	"category" varchar(50) NOT NULL,
	"transmission" varchar(50) NOT NULL,
	"fuel_type" varchar(50) NOT NULL,
	"base_daily_rate" numeric(10, 2) NOT NULL,
	"vehicles_available" integer NOT NULL,
	"location" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_policies_embeddings" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasonal_pricing_matrix" (
	"month" integer NOT NULL,
	"category" varchar(50) NOT NULL,
	"multiplier" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_logs" ADD CONSTRAINT "booking_logs_customer_id_customer_profiles_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer_profiles"("customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_logs" ADD CONSTRAINT "booking_logs_vehicle_id_fleet_catalog_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_catalog"("vehicle_id") ON DELETE no action ON UPDATE no action;