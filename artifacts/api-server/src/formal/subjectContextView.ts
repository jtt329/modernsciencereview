import type {FormalSubjectDirectoryEntry} from './contract';
/** Server additionally binds every linked subject's exact evidence fingerprint. */
export function isSubjectContextVersionCurrent(subject:FormalSubjectDirectoryEntry):boolean{
 const c=subject.context;return Boolean(c&&c.version==='subject-context-v1'&&subject.contextCurrent!==false&&c.sourceVersion===subject.version&&c.hierarchyVersion===(subject.hierarchyVersion||0));
}
