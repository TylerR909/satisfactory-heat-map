/**
 * Map older hand-curated / community-ish item ids → Docs ClassName ids.
 * Used when rehydrating localStorage or decoding plan hashes after Docs parse.
 */
export const PRODUCT_ID_ALIASES: Record<string, string> = {
  // Hand-curated / wiki-ish names → Docs ClassName
  Desc_HeavyModularFrame_C: "Desc_ModularFrameHeavy_C",
  Desc_ReinforcedIronPlate_C: "Desc_IronPlateReinforced_C",
  Desc_EncasedIndustrialBeam_C: "Desc_SteelPlateReinforced_C",
  Desc_Turbofuel_C: "Desc_LiquidTurboFuel_C",
  Desc_TurboFuel_C: "Desc_LiquidTurboFuel_C",
  Desc_Screw_C: "Desc_IronScrew_C",
  Desc_Concrete_C: "Desc_Cement_C",
  Desc_SteelBeam_C: "Desc_SteelPlate_C", // Docs: steel beam is Desc_SteelPlate_C
  // Legacy plan-hash table ids → Docs ClassName (so decode/apply still works)
  Desc_AILimiter_C: "Desc_CircuitBoardHighSpeed_C",
  Desc_AlcladAluminumSheet_C: "Desc_AluminumPlate_C",
  Desc_BlackPowder_C: "Desc_Gunpowder_C",
  Desc_Quickwire_C: "Desc_HighSpeedWire_C",
  Desc_RadioControlUnit_C: "Desc_ModularFrameLightweight_C",
  Desc_Supercomputer_C: "Desc_ComputerSuper_C",
};

export function canonicalizeProductId(id: string): string {
  return PRODUCT_ID_ALIASES[id] ?? id;
}
