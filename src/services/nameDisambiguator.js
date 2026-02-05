import { doubleMetaphone } from 'double-metaphone';
import jaroWinkler from 'jaro-winkler';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';
import { getDb, getSettingValue } from '../config/database.js';
import logger from './logger.js';
