import baseValidators from './validators.json' with { type: 'json' };
import { customerAccountValidators } from '../../modules/customer/account.validators.js';

export default { ...baseValidators, ...customerAccountValidators };
