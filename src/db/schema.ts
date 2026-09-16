import { pgTable, varchar, integer, decimal, date, text } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { customType } from 'drizzle-orm/pg-core';

// Custom pgvector type for Drizzle
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

export const fleetCatalog = pgTable('fleet_catalog', {
  vehicleId: varchar('vehicle_id', { length: 50 }).primaryKey(),
  make: varchar('make', { length: 100 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  year: integer('year').notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  transmission: varchar('transmission', { length: 50 }).notNull(),
  fuelType: varchar('fuel_type', { length: 50 }).notNull(),
  baseDailyRate: decimal('base_daily_rate', { precision: 10, scale: 2 }).notNull(),
  vehiclesAvailable: integer('vehicles_available').notNull(),
  location: varchar('location', { length: 100 }).notNull(),
});

export const customerProfiles = pgTable('customer_profiles', {
  customerId: varchar('customer_id', { length: 50 }).primaryKey(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  birthDate: date('birth_date').notNull(),
  licenseNumber: varchar('license_number', { length: 100 }).notNull(),
  licenseIssueDate: date('license_issue_date').notNull(),
  licenseExpDate: date('license_exp_date').notNull(),
  riskCategory: varchar('risk_category', { length: 50 }).notNull(),
});

export const bookingLogs = pgTable('booking_logs', {
  bookingId: varchar('booking_id', { length: 50 }).primaryKey(),
  customerId: varchar('customer_id', { length: 50 }).references(() => customerProfiles.customerId),
  vehicleId: varchar('vehicle_id', { length: 50 }).references(() => fleetCatalog.vehicleId),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  days: integer('days').notNull(),
  insuranceOption: varchar('insurance_option', { length: 50 }).notNull(),
  depositAmount: decimal('deposit_amount', { precision: 10, scale: 2 }).notNull(),
  discountCode: varchar('discount_code', { length: 50 }),
  seasonalMultiplier: decimal('seasonal_multiplier', { precision: 5, scale: 2 }).notNull(),
});

export const seasonalPricingMatrix = pgTable('seasonal_pricing_matrix', {
  month: integer('month').notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  multiplier: decimal('multiplier', { precision: 5, scale: 2 }).notNull(),
});

// RAG Knowledge Base Table
export const rentalPoliciesEmbeddings = pgTable('rental_policies_embeddings', {
  id: varchar('id', { length: 255 }).primaryKey(),
  content: text('content').notNull(),
  embedding: vector('embedding').notNull(),
});

// Zod Schemas
export const insertFleetSchema = createInsertSchema(fleetCatalog);
export const selectFleetSchema = createSelectSchema(fleetCatalog);
