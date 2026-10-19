// Without type information, the rule doesn't know `emitDecoratorMetadata` needs `Service` at run time
import { Service } from './service'

function Injectable(): ClassDecorator {
  return () => {}
}

@Injectable()
export class Controller {
  constructor(private readonly service: Service) {}
}
