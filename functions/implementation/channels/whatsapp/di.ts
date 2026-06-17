import { container } from 'tsyringe'
import { IChannelConfig } from '../../../domain/models/IChannelConfig'
import { IAssignmentRepository } from '../../../domain/repositories/IAssignmentRepository'
import { FbAssignmentRepository } from '../../database/whatsapp-firebase/repositories/FbAssignmentRepository'
import { AssignTicketUseCase } from '../../../domain/usecases/AssignTicketUseCase'
import { ReconcileAssignmentsUseCase } from '../../../domain/usecases/ReconcileAssignmentsUseCase'
import { whatsappConfig } from './config'

const whatsappContainer = container.createChildContainer()
whatsappContainer.registerInstance<IChannelConfig>('ChannelConfig', whatsappConfig)
whatsappContainer.register<IAssignmentRepository>('AssignmentRepository', { useClass: FbAssignmentRepository })

export const whatsappAssign = whatsappContainer.resolve(AssignTicketUseCase)
export const whatsappReconcile = whatsappContainer.resolve(ReconcileAssignmentsUseCase)
