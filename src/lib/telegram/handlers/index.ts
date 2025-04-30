import configHandlers from './config'
import { Handler } from '../types'

const handlers: Record<string, Handler> = {
  config: configHandlers,
}

export default handlers
