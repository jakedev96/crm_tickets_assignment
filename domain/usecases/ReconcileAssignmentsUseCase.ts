import { inject, injectable } from 'tsyringe'
import { IAssignmentRepository } from '../repositories/IAssignmentRepository'

@injectable()
export class ReconcileAssignmentsUseCase {
  constructor(@inject('AssignmentRepository') private readonly repo: IAssignmentRepository) {}

  execute = () => this.repo.reconcile()
}
