import assert from "node:assert/strict";
import test from "node:test";
import { scopeSchema, hasValidYearRange, type Scope } from "@/lib/watch-schema";

const baseScope: Scope = {
  condition: "any",
  yearMin: null,
  yearMax: null,
  papers: "not_required",
  box: "not_required",
  warranty: "none_ok",
};

test("hasValidYearRange returns true when both yearMin and yearMax are null", () => {
  assert.equal(hasValidYearRange({ ...baseScope, yearMin: null, yearMax: null }), true);
});

test("hasValidYearRange returns true when only yearMin is set", () => {
  assert.equal(hasValidYearRange({ ...baseScope, yearMin: 2020, yearMax: null }), true);
});

test("hasValidYearRange returns true when only yearMax is set", () => {
  assert.equal(hasValidYearRange({ ...baseScope, yearMin: null, yearMax: 2024 }), true);
});

test("hasValidYearRange returns true when yearMin <= yearMax", () => {
  assert.equal(hasValidYearRange({ ...baseScope, yearMin: 2020, yearMax: 2024 }), true);
  assert.equal(hasValidYearRange({ ...baseScope, yearMin: 2022, yearMax: 2022 }), true);
});

test("hasValidYearRange returns false when yearMin > yearMax", () => {
  assert.equal(hasValidYearRange({ ...baseScope, yearMin: 2024, yearMax: 2020 }), false);
  assert.equal(hasValidYearRange({ ...baseScope, yearMin: 2023, yearMax: 2022 }), false);
});

test("scopeSchema validates condition enum values", () => {
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, condition: "any" }));
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, condition: "unworn" }));
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, condition: "pre_owned" }));
  assert.throws(() => scopeSchema.parse({ ...baseScope, condition: "invalid" }));
});

test("scopeSchema validates papers enum values", () => {
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, papers: "required" }));
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, papers: "not_required" }));
  assert.throws(() => scopeSchema.parse({ ...baseScope, papers: "optional" }));
});

test("scopeSchema validates box enum values", () => {
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, box: "required" }));
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, box: "not_required" }));
  assert.throws(() => scopeSchema.parse({ ...baseScope, box: "maybe" }));
});

test("scopeSchema validates warranty enum values", () => {
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, warranty: "factory_remaining" }));
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, warranty: "third_party_ok" }));
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, warranty: "none_ok" }));
  assert.throws(() => scopeSchema.parse({ ...baseScope, warranty: "invalid" }));
});

test("scopeSchema accepts nullable integer years", () => {
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, yearMin: null, yearMax: null }));
  assert.doesNotThrow(() => scopeSchema.parse({ ...baseScope, yearMin: 2020, yearMax: 2024 }));
  assert.throws(() => scopeSchema.parse({ ...baseScope, yearMin: 2020.5 }));
  assert.throws(() => scopeSchema.parse({ ...baseScope, yearMax: "2024" }));
});

test("scopeSchema rejects missing required fields", () => {
  assert.throws(() => scopeSchema.parse({ condition: "any" }));
  assert.throws(() => scopeSchema.parse({ papers: "required" }));
  assert.throws(() => scopeSchema.parse({}));
});
