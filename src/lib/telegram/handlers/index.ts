import configHandlers from './config'
import imageHandlers from './image'
import { Handler } from '../types'

const handlers: Record<string, Handler> = {
  config: configHandlers,
  image: imageHandlers,
}

export default handlers
