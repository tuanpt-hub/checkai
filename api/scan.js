import { dispatch } from './_lib/dispatch.js';
import scan from './_lib/op-scan.js';
import entity from './_lib/op-entity.js';
import claim from './_lib/op-verify-claim.js';

// Dữ kiện: quét website, Wikidata, kiểm chứng claim: /api/scan, /api/scan?op=entity, /api/scan?op=claim
export default dispatch({ scan, entity, claim }, 'scan');
