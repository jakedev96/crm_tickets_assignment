export interface IChannelConfig {
  /** Identificador do canal — usado em logs */
  channel: string
  /** Coleção Firestore da fila do canal */
  queueCollection: string
  /** Coleção Firestore dos tickets do canal */
  ticketsCollection: string
  /** Valores de pending_type que somente AG2 pode atender */
  pendingTypesAG2Only: string[]
}
