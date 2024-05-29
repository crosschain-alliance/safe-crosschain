import { addToCallback, CircuitValue, CircuitValue256, getSolidityMapping } from "@axiom-crypto/client"

// all fields of `CircuitInputs` must be `CircuitValue`, `CircuitValue256`,
// or static arrays over these types
export interface CircuitInputs {
  blockNumber: CircuitValue
  peripheral: CircuitValue
  mainSafe: CircuitValue
  slot: CircuitValue256
}

export const defaultInputs = {
  blockNumber: 10606042,
  peripheral: "0x910A6D9Fc94500a017A59F7BEED1Ddf6f96227cE",
  mainSafe: "0x83aC9D0A29455b160Db66e14bA12295a7F2dfcF1",
  slot: 0,
}

export const circuit = async (inputs: CircuitInputs) => {
  const mapping = getSolidityMapping(inputs.blockNumber, inputs.peripheral, inputs.slot)
  const val = await mapping.key(inputs.mainSafe)
  addToCallback(inputs.peripheral)
  addToCallback(val)
}
