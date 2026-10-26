import type { z } from 'zod'

import type {
  seedInterfaceDummySchema,
  seedInterfaceEntrySchema,
  seedInterfaceEthernetSchema,
  seedInterfaceVlanSchema,
  seedInterfacesSchema,
} from './interfaces.js'

export type SeedInterfaceEthernet = z.infer<typeof seedInterfaceEthernetSchema>
export type SeedInterfaceVlan = z.infer<typeof seedInterfaceVlanSchema>
export type SeedInterfaceDummy = z.infer<typeof seedInterfaceDummySchema>
export type SeedInterfaceEntry = z.infer<typeof seedInterfaceEntrySchema>
export type SeedInterfaces = z.infer<typeof seedInterfacesSchema>
