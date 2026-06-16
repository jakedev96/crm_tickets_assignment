import { IChannelConfig } from '../../../domain/models/IChannelConfig'

export const whatsappConfig: IChannelConfig = {
  channel:             'whatsapp',
  queueCollection:     'crm_cs_queue',
  ticketsCollection:   'tickets',
  pendingTypesAG2Only: ['pendingAG2', 'pendingShopper'],
}
