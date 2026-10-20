// Constrain the model's transport shape. Cross-references and every AST field
// are still independently validated by package.ts before anything is saved.
const string = {type:'string'};
const strings = {type:'array',items:string,maxItems:30};
const object = (properties:Record<string,unknown>,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const transportShape = object({
  assumptions:strings,
  symbols:{type:'array',minItems:1,maxItems:32,items:object({name:{...string,description:'Unique ASCII identifier. Include every derived definition symbol as well as constants and independent variables.'},label:string,domain:{type:'string',enum:['real','positive','nonzero']},dimensions:{type:'array',minItems:3,maxItems:3,items:{type:'integer',minimum:-12,maximum:12}}})},
  definitions:{type:'array',maxItems:30,items:object({symbol:{...string,description:'A name declared in symbols. Define each symbol at most once; never define differentiation variables.'},expressionJson:{...string,description:'A JSON-encoded expression AST object, never a formula or executable code.'},description:string})},
  claims:{type:'array',minItems:1,maxItems:6,items:object({id:string,title:string,lhsJson:string,rhsJson:string,explanation:string})},
  consequences:{type:'array',maxItems:8,items:object({title:string,text:string,claimIds:{type:'array',minItems:1,maxItems:6,items:string}})},
  limitations:strings,
});

// The provider rejects the combined grammar with all array bounds expanded.
// Transport constrains types/required keys; package.ts enforces every bound and
// rejects extra fields after decoding, independently of provider behavior.
export const proposalSchema = JSON.parse(JSON.stringify(transportShape, (key,value) =>
  ['minItems','maxItems','minimum','maximum','additionalProperties'].includes(key) ? undefined : value,
));

/** Decode only JSON data. Executable expressions/string parsers are never used. */
export function decodeProposal(value: any): Record<string, unknown> {
  if(!value || typeof value!=='object' || !Array.isArray(value.definitions) || !Array.isArray(value.claims)) throw new Error('Incomplete proposal lists.');
  return {...value,
    definitions:value.definitions.map((d:any)=>({symbol:d.symbol,expression:JSON.parse(d.expressionJson),description:d.description})),
    claims:value.claims.map((c:any)=>({id:c.id,title:c.title,lhs:JSON.parse(c.lhsJson),rhs:JSON.parse(c.rhsJson),explanation:c.explanation})),
  };
}
