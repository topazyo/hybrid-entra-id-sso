import { Logger } from '../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { EventBus } from '../utils/EventBus';

interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowStep[];
  errorHandling: ErrorHandlingStrategy;
  timeout: number;
}

export class WorkflowManager {
  private logger: Logger;
  private metrics: MetricsCollector;
  private eventBus: EventBus;
  private activeWorkflows: Map<string, WorkflowInstance>;

  constructor() {
    this.logger = new Logger('WorkflowManager');
    this.metrics = new MetricsCollector();
    this.eventBus = new EventBus();
    this.activeWorkflows = new Map();
  }

  async startWorkflow(
    workflowId: string,
    context: WorkflowContext
  ): Promise<WorkflowInstance> {
    try {
      const definition = await this.loadWorkflowDefinition(workflowId);
      const instance = this.createWorkflowInstance(definition, context);

      this.activeWorkflows.set(instance.id, instance);
      await this.executeWorkflow(instance);

      return instance;
    } catch (error) {
      this.logger.error('Workflow start failed', { workflowId, error });
      throw new WorkflowError('Failed to start workflow', error);
    }
  }

  async handleWorkflowStep(
    instanceId: string,
    stepResult: StepResult
  ): Promise<void> {
    const instance = this.activeWorkflows.get(instanceId);
    if (!instance) {
      throw new WorkflowError('Workflow instance not found');
    }

    try {
      await this.processStepResult(instance, stepResult);
      
      if (this.isWorkflowComplete(instance)) {
        await this.completeWorkflow(instance);
      } else {
        await this.executeNextStep(instance);
      }
    } catch (error) {
      await this.handleWorkflowError(instance, error);
    }
  }

  private async executeWorkflow(instance: WorkflowInstance): Promise<void> {
    const startEvent = {
      type: 'WorkflowStarted',
      workflowId: instance.definition.id,
      instanceId: instance.id,
      timestamp: new Date()
    };

    await this.eventBus.publish('workflow', startEvent);
    await this.executeNextStep(instance);
  }

  private async handleWorkflowError(
    instance: WorkflowInstance,
    error: Error
  ): Promise<void> {
    this.logger.error('Workflow error occurred', { instance, error });

    const errorEvent = {
      type: 'WorkflowError',
      workflowId: instance.definition.id,
      instanceId: instance.id,
      error: error.message,
      timestamp: new Date()
    };

    await this.eventBus.publish('workflow.error', errorEvent);
    await this.executeErrorHandling(instance, error);
  }
}