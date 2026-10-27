import type { FormalSubject, FormalSubjectDirectoryEntry } from '../../../api-server/src/formal/contract';
import type { PublishedFormalPaper } from '../../../api-server/src/formal/publishedContract';

export type LibraryView = 'papers' | 'subjects';
export type LibrarySort = 'newest' | 'oldest' | 'title' | 'author' | 'assessment';
export interface LibraryFilters { view:LibraryView; query:string; subject:string; sort:LibrarySort; }
const sorts:LibrarySort[]=['newest','oldest','title','author','assessment'];
export const emptyLibraryFilters:LibraryFilters={view:'papers',query:'',subject:'all',sort:'newest'};
export function libraryFiltersFromUrl(search:string):LibraryFilters {
  const p=new URLSearchParams(search),sort=p.get('sort') as LibrarySort;
  return {view:p.get('view')==='subjects'?'subjects':'papers',query:p.get('q')||'',subject:p.get('subject')||'all',sort:sorts.includes(sort)?sort:'newest'};
}
/** Keep root and /formal-lab aliases, unrelated query parameters, and copied filters intact. */
export function libraryLocation(pathname:string,search:string,filters:LibraryFilters):string {
  const p=new URLSearchParams(search),path=/^\/formal-lab\/?$/.test(pathname)?'/formal-lab':'/';
  for(const [key,value] of [['view',filters.view==='subjects'?'subjects':''],['q',filters.query.trim()],['subject',filters.subject==='all'?'':filters.subject],['sort',filters.sort==='newest'?'':filters.sort]]) value?p.set(key,value):p.delete(key);
  return path+(p.size?'?'+p.toString():'');
}
const searchable=(text:string)=>text.normalize('NFKC').toLocaleLowerCase();
const dateValue=(text:string)=>{const value=Date.parse(text);return Number.isNaN(value)?0:value;};
const assessmentOrder=(paper:PublishedFormalPaper)=>({ 'ready-for-public-reading':0,'author-clarification-needed':1,'mathematical-correction-needed':2 }[paper.assessment?.readiness||'']??3);
export function selectLibraryPapers(papers:readonly PublishedFormalPaper[],filters:Pick<LibraryFilters,'query'|'subject'|'sort'>):PublishedFormalPaper[] {
  const needle=searchable(filters.query.trim());
  const selected=papers.filter(paper=>(filters.subject==='all'||paper.subject.slug===filters.subject)&&(!needle||searchable([paper.title,paper.authors,paper.summary,paper.mainClaim,paper.assessment?.summary||'',paper.subject.title,paper.subject.slug,...(paper.concepts||[])].join(' ')).includes(needle)));
  const title=(a:PublishedFormalPaper,b:PublishedFormalPaper)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'})||a.id.localeCompare(b.id);
  return selected.sort((a,b)=>filters.sort==='oldest'?dateValue(a.publishedAt)-dateValue(b.publishedAt)||title(a,b):filters.sort==='title'?title(a,b):filters.sort==='author'?a.authors.localeCompare(b.authors,undefined,{sensitivity:'base'})||title(a,b):filters.sort==='assessment'?assessmentOrder(a)-assessmentOrder(b)||title(a,b):dateValue(b.publishedAt)-dateValue(a.publishedAt)||title(a,b));
}
export function librarySubjectOptions(papers:readonly PublishedFormalPaper[]):{slug:string;title:string;count:number}[] {
  const subjects=new Map<string,{slug:string;title:string;count:number}>();
  for(const paper of papers){const previous=subjects.get(paper.subject.slug);subjects.set(paper.subject.slug,{slug:paper.subject.slug,title:paper.subject.title,count:(previous?.count||0)+1});}
  return [...subjects.values()].sort((a,b)=>a.title.localeCompare(b.title));
}
export function safeLibraryUrl(value?:string):string|undefined {
  return value&&(/^https?:\/\//i.test(value)||/^\/(?![\\/])/.test(value))?value:undefined;
}
export function paperReviewUrl(paper:PublishedFormalPaper):string {
  return safeLibraryUrl(paper.reviewUrl)||`/formal-lab?submission=${encodeURIComponent(paper.id)}&tab=review`;
}
export function subjectUrl(slug:string):string {return `/formal-lab/subjects/${encodeURIComponent(slug)}`;}
export type LibrarySubjectEntry = FormalSubjectDirectoryEntry;
export function selectLibrarySubjects(subjects:readonly LibrarySubjectEntry[],filters:Pick<LibraryFilters,'query'|'subject'|'sort'>):LibrarySubjectEntry[] {
  const needle=searchable(filters.query.trim()),selected=subjects.filter(item=>(filters.subject==='all'||item.slug===filters.subject||item.parentSlug===filters.subject||item.children?.some(child=>child.slug===filters.subject))&&(!needle||searchable([item.title,item.slug,item.parent?.title||'',...(item.children||[]).map(child=>child.title)].join(' ')).includes(needle)));
  return selected.sort((a,b)=>filters.sort==='newest'?dateValue(b.updatedAt)-dateValue(a.updatedAt)||a.title.localeCompare(b.title):filters.sort==='oldest'?dateValue(a.updatedAt)-dateValue(b.updatedAt)||a.title.localeCompare(b.title):a.title.localeCompare(b.title));
}

/** Connections use an exact shared claim in one revision; withheld records stay in audit, not this map. */
export function subjectConceptMap(subject:FormalSubject) {
  const eligible=subject.paragraphs.filter(node=>node.placementStatus!=='historical'&&node.admission?.status!=='withheld'&&node.sources.some(source=>source.placementStatus!=='historical'&&source.admission?.status!=='withheld'));
  const nodes=eligible.slice(0,6),keys=nodes.map(node=>new Set(node.sources.filter(source=>source.placementStatus!=='historical'&&source.admission?.status!=='withheld').flatMap(source=>source.claimIds.map(id=>`${source.submissionId}:${source.revisionId}:${id}`))));
  const edges:[number,number][]=[];
  for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)if([...keys[a]].some(key=>keys[b].has(key)))edges.push([a,b]);
  return {nodes,edges,total:eligible.length};
}
