import { z } from "zod";

export const scopeSchema = z.object({
  condition: z.enum(["any", "unworn", "pre_owned"]),
  yearMin: z.number().int().nullable(),
  yearMax: z.number().int().nullable(),
  papers: z.enum(["required", "not_required"]),
  box: z.enum(["required", "not_required"]),
  warranty: z.enum(["factory_remaining", "third_party_ok", "none_ok"]),
});

export type Scope = z.infer<typeof scopeSchema>;

export function hasValidYearRange(scope: Scope) {
  return !(scope.yearMin && scope.yearMax && scope.yearMin > scope.yearMax);
}
