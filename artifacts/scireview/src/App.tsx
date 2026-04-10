import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Sparkles, Search, ArrowLeft, Heart, Clock, User, Share2, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import Navbar from './components/Navbar';
import PaperCard from './components/PaperCard';
import ReviewCard from './components/ReviewCard';
import CommentSection from './components/CommentSection';
import SubmissionForm from './components/SubmissionForm';
import BulkSubmissionForm from './components/BulkSubmissionForm';
import { Paper, AIReview, Comment } from './types';
import { reviewPaper, ReviewSource } from './services/reviewService';
import { formatDistanceToNow } from 'date-fns';
import { auth, db, signInWithGoogle, logout, handleFirestoreError, OperationType, isFirebaseConfigured } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp,
  doc, updateDoc, increment, setDoc, deleteDoc, where
} from 'firebase/firestore';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || '';

const FIELDS = ['All Fields', 'Physics', 'Mathematics', 'Computer Science', 'Biology', 'Chemistry'];
const RANKINGS = ['Top Rated', 'Most Viewed', 'Most Discussed', 'For You'];
const TIMEFRAMES = ['All Time', 'Past Year', 'Past Month', 'Past Week'];

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [reviews, setReviews] = useState<Record<string, AIReview>>({});
  const [comments, setComments] = useState<Comment[]>([]);
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedField, setSelectedField] = useState('All Fields');
  const [selectedSubfield, setSelectedSubfield] = useState('All Subfields');
  const [selectedRanking, setSelectedRanking] = useState('Top Rated');
  const [selectedTimeframe, setSelectedTimeframe] = useState('All Time');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getSubfields = () => {
    if (selectedField === 'All Fields') return [];
    const subfields = new Set<string>();
    papers
      .filter(p => p.field === selectedField)
      .forEach(p => p.subfields?.forEach(s => subfields.add(s)));
    return Array.from(subfields);
  };

  const subfields = getSubfields();
  const selectedPaper = papers.find(p => p.id === selectedPaperId);
  const selectedReview = selectedPaper?.aiReviewId ? reviews[selectedPaper.aiReviewId] : null;

  useEffect(() => { setSelectedSubfield('All Subfields'); }, [selectedField]);

  // Auth listener
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName,
            email: firebaseUser.email,
            photoURL: firebaseUser.photoURL,
            role: 'user',
            createdAt: serverTimestamp()
          }, { merge: true });
        } catch (err) {
          console.error('Error syncing user profile:', err);
        }
        const likesQuery = query(collection(db, 'likes'), where('userId', '==', firebaseUser.uid));
        onSnapshot(likesQuery, (snapshot) => {
          const likes = new Set<string>();
          snapshot.forEach(d => likes.add(d.data().targetId));
          setUserLikes(likes);
        });
      } else {
        setUserLikes(new Set());
      }
    });
    return () => unsubscribe();
  }, []);

  // Papers listener
  useEffect(() => {
    if (!isFirebaseConfigured) { setIsLoading(false); return; }
    const q = query(collection(db, 'papers'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const papersData: Paper[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        papersData.push({
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toMillis() || Date.now()
        } as Paper);
      });
      setPapers(papersData);
      setIsLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'papers');
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Reviews listener
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsubscribe = onSnapshot(collection(db, 'reviews'), (snapshot) => {
      const reviewsData: Record<string, AIReview> = {};
      snapshot.forEach((d) => {
        const data = d.data();
        reviewsData[d.id] = {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toMillis() || Date.now()
        } as AIReview;
      });
      setReviews(reviewsData);
    });
    return () => unsubscribe();
  }, []);

  // Comments listener for selected paper
  useEffect(() => {
    if (!isFirebaseConfigured || !selectedPaperId) { setComments([]); return; }
    const q = query(
      collection(db, 'comments'),
      where('targetId', '==', selectedPaperId),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const commentsData: Comment[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        commentsData.push({
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toMillis() || Date.now()
        } as Comment);
      });
      setComments(commentsData);
    });
    return () => unsubscribe();
  }, [selectedPaperId]);

  // Increment view count
  useEffect(() => {
    if (!isFirebaseConfigured || !selectedPaperId) return;
    if (selectedPaperId) {
      const paperRef = doc(db, 'papers', selectedPaperId);
      updateDoc(paperRef, { viewCount: increment(1) }).catch(console.error);
    }
  }, [selectedPaperId]);

  const handleLogin = async () => {
    try { await signInWithGoogle(); } catch { setError('Failed to sign in. Please try again.'); }
  };

  const handleLogout = async () => {
    try { await logout(); setSelectedPaperId(null); } catch { setError('Failed to log out.'); }
  };

  const handleSubmitPaper = async (source: ReviewSource, skipSelect = false) => {
    if (!user) return;
    const reviewResult = await reviewPaper(source);
    const paperRef = await addDoc(collection(db, 'papers'), {
      title: reviewResult.title,
      content: source.type === 'text' ? source.data : `[PDF Upload] ${reviewResult.title}`,
      authorId: user.uid,
      authorName: reviewResult.authorName,
      createdAt: serverTimestamp(),
      status: 'published',
      likesCount: 0,
      viewCount: 0,
      commentCount: 0,
      field: reviewResult.field,
      subfields: reviewResult.subfields,
      score: reviewResult.score,
      modelName: reviewResult.modelName,
    });
    const { title: _t, authorName: _a, ...reviewData } = reviewResult;
    const reviewRef = await addDoc(collection(db, 'reviews'), {
      ...reviewData,
      paperId: paperRef.id,
      createdAt: serverTimestamp(),
      likesCount: 0,
    });
    await updateDoc(paperRef, { aiReviewId: reviewRef.id });
    if (!skipSelect) setSelectedPaperId(paperRef.id);
  };

  const handleLike = async (targetId: string, type: 'paper' | 'review', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { handleLogin(); return; }
    const likeId = `${user.uid}_${targetId}`;
    const likeRef = doc(db, 'likes', likeId);
    const targetRef = doc(db, type === 'paper' ? 'papers' : 'reviews', targetId);
    try {
      if (userLikes.has(targetId)) {
        await deleteDoc(likeRef);
        await updateDoc(targetRef, { likesCount: increment(-1) });
      } else {
        await setDoc(likeRef, { targetId, userId: user.uid, createdAt: serverTimestamp() });
        await updateDoc(targetRef, { likesCount: increment(1) });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'likes');
    }
  };

  const handleAddComment = async (content: string) => {
    if (!user || !selectedPaperId) return;
    await addDoc(collection(db, 'comments'), {
      targetId: selectedPaperId,
      authorId: user.uid,
      authorName: user.displayName,
      content,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'papers', selectedPaperId), { commentCount: increment(1) });
  };

  const handleDeletePaper = async (paperId: string) => {
    if (!user || user.email !== ADMIN_EMAIL) return;
    if (!window.confirm('Delete this paper and its review? This cannot be undone.')) return;
    const paper = papers.find(p => p.id === paperId);
    if (paper?.aiReviewId) await deleteDoc(doc(db, 'reviews', paper.aiReviewId));
    await deleteDoc(doc(db, 'papers', paperId));
    setSelectedPaperId(null);
  };

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-10 rounded-3xl shadow-xl border border-slate-200 max-w-lg w-full space-y-6 text-center">
          <div className="bg-indigo-600 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-100">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">SciReview AI</h1>
            <p className="text-indigo-600 font-bold text-sm uppercase tracking-widest mt-1">Setup Required</p>
          </div>
          <p className="text-slate-600 font-medium leading-relaxed">
            This app needs Firebase credentials to enable Google login and data storage. Please add the following environment secrets to get started:
          </p>
          <div className="bg-slate-900 rounded-2xl p-5 text-left space-y-1.5">
            {[
              'VITE_FIREBASE_API_KEY',
              'VITE_FIREBASE_AUTH_DOMAIN',
              'VITE_FIREBASE_PROJECT_ID',
              'VITE_FIREBASE_STORAGE_BUCKET',
              'VITE_FIREBASE_MESSAGING_SENDER_ID',
              'VITE_FIREBASE_APP_ID',
            ].map(v => (
              <div key={v} className="flex items-center gap-2">
                <span className="text-emerald-400 font-mono text-xs font-bold">✓</span>
                <code className="text-slate-300 font-mono text-xs">{v}</code>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1 border-t border-slate-700">
              <span className="text-slate-500 font-mono text-xs font-bold">○</span>
              <code className="text-slate-500 font-mono text-xs">VITE_ADMIN_EMAIL (optional)</code>
            </div>
          </div>
          <p className="text-slate-400 text-xs font-medium">
            Find these values in Firebase Console → Project Settings → Your apps → SDK setup and configuration
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-rose-100 text-center max-w-md space-y-4">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-2xl font-black text-slate-900">Something went wrong</h2>
          <p className="text-slate-600 font-medium">{error}</p>
          <button onClick={() => window.location.reload()} className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-colors">
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar
        user={user}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onNewPaper={() => setIsSubmitting(true)}
        onBulkUpload={() => setIsBulkSubmitting(true)}
        adminEmail={ADMIN_EMAIL}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <AnimatePresence mode="wait">
          {!selectedPaperId ? (
            <motion.div
              key="feed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              {/* Hero */}
              <div className="text-center space-y-4 max-w-3xl mx-auto mb-16">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest"
                >
                  <Sparkles className="w-4 h-4" />
                  AI-Powered Scientific Journal
                </motion.div>
                <h1 className="text-5xl md:text-7xl font-black text-slate-900 tracking-tight leading-none">
                  The Future of <span className="text-indigo-600">Scientific Review</span>
                </h1>
                <p className="text-xl text-slate-600 font-medium max-w-2xl mx-auto">
                  Submit your research, get an instant AI assessment from GPT-5.2, and timestamp your work on the public record.
                </p>
              </div>

              {/* Search + Filters */}
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search papers, authors, or topics..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 text-slate-900 font-medium outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {FIELDS.map(f => (
                      <button
                        key={f}
                        onClick={() => setSelectedField(f)}
                        className={`px-6 py-2.5 rounded-full font-bold text-sm transition-all border ${
                          selectedField === f
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <AnimatePresence>
                    {selectedField !== 'All Fields' && subfields.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-wrap gap-2 pt-2 border-t border-slate-100"
                      >
                        <button
                          onClick={() => setSelectedSubfield('All Subfields')}
                          className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${
                            selectedSubfield === 'All Subfields'
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'
                          }`}
                        >
                          All Subfields
                        </button>
                        {subfields.map(s => (
                          <button
                            key={s}
                            onClick={() => setSelectedSubfield(s)}
                            className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${
                              selectedSubfield === s
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="inline-flex p-1 bg-white border border-slate-200 rounded-2xl shadow-sm">
                    {RANKINGS.map(r => (
                      <button
                        key={r}
                        onClick={() => setSelectedRanking(r)}
                        className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                          selectedRanking === r ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {TIMEFRAMES.map(t => (
                      <button
                        key={t}
                        onClick={() => setSelectedTimeframe(t)}
                        className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${
                          selectedTimeframe === t ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Paper Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl h-64 animate-pulse border border-slate-100" />
                  ))
                ) : (
                  papers
                    .filter(p => {
                      const matchesSearch =
                        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        p.authorName.toLowerCase().includes(searchQuery.toLowerCase());
                      const matchesField = selectedField === 'All Fields' || p.field === selectedField;
                      const matchesSubfield = selectedSubfield === 'All Subfields' || p.subfields?.includes(selectedSubfield);
                      const now = Date.now();
                      let matchesTime = true;
                      if (selectedTimeframe === 'Past Week') matchesTime = p.createdAt > now - 7 * 86400000;
                      else if (selectedTimeframe === 'Past Month') matchesTime = p.createdAt > now - 30 * 86400000;
                      else if (selectedTimeframe === 'Past Year') matchesTime = p.createdAt > now - 365 * 86400000;
                      return matchesSearch && matchesField && matchesSubfield && matchesTime;
                    })
                    .sort((a, b) => {
                      if (selectedRanking === 'Most Viewed') return b.viewCount - a.viewCount;
                      if (selectedRanking === 'Most Discussed') return b.commentCount - a.commentCount;
                      if (selectedRanking === 'Top Rated') return (b.score || 0) - (a.score || 0);
                      return b.createdAt - a.createdAt;
                    })
                    .map(paper => (
                      <PaperCard
                        key={paper.id}
                        paper={paper}
                        onClick={setSelectedPaperId}
                        onLike={(id, e) => handleLike(id, 'paper', e)}
                        isLiked={userLikes.has(paper.id)}
                      />
                    ))
                )}
                {!isLoading && papers.length === 0 && (
                  <div className="col-span-full text-center py-24">
                    <p className="text-slate-400 font-bold italic">No papers yet. Be the first to submit!</p>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto space-y-12"
            >
              <button
                onClick={() => setSelectedPaperId(null)}
                className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold transition-colors group mb-8"
              >
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                Back to Feed
              </button>

              {!selectedPaper ? (
                <div className="text-center py-24">
                  <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
                  <p className="text-slate-500 font-bold">Loading paper details...</p>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                        Scientific Paper
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(selectedPaper.createdAt)} ago
                      </div>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black text-slate-900 leading-tight">
                      {selectedPaper.title}
                    </h1>
                    <div className="flex items-center justify-between py-6 border-y border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                          <User className="w-6 h-6 text-slate-400" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-900 leading-tight">{selectedPaper.authorName}</span>
                          <span className="text-xs text-slate-500 font-medium">
                            {selectedPaper.authorName.includes(',') ? 'Verified Authors' : 'Verified Author'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <button className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors shadow-sm">
                          <Share2 className="w-5 h-5 text-slate-600" />
                        </button>
                        {ADMIN_EMAIL && user?.email === ADMIN_EMAIL && (
                          <button
                            onClick={() => handleDeletePaper(selectedPaper.id)}
                            className="p-3 bg-rose-50 border border-rose-100 rounded-2xl hover:bg-rose-100 transition-colors shadow-sm"
                          >
                            <Trash2 className="w-5 h-5 text-rose-600" />
                          </button>
                        )}
                        <button
                          onClick={(e) => handleLike(selectedPaper.id, 'paper', e)}
                          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-colors shadow-sm border ${
                            userLikes.has(selectedPaper.id)
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100'
                          }`}
                        >
                          <Heart className={`w-5 h-5 ${userLikes.has(selectedPaper.id) ? 'fill-current' : ''}`} />
                          {selectedPaper.likesCount}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="prose prose-slate max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {selectedPaper.content}
                    </ReactMarkdown>
                  </div>

                  {selectedReview && (
                    <div className="pt-12">
                      <ReviewCard
                        review={selectedReview}
                        onLike={(id, e) => handleLike(id, 'review', e)}
                        isLiked={userLikes.has(selectedReview.id)}
                      />
                    </div>
                  )}

                  <CommentSection
                    comments={comments}
                    onAddComment={handleAddComment}
                    user={user}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {isSubmitting && (
          <SubmissionForm
            onSubmit={handleSubmitPaper}
            onClose={() => setIsSubmitting(false)}
          />
        )}
        {isBulkSubmitting && (
          <BulkSubmissionForm
            onSubmit={handleSubmitPaper}
            onClose={() => setIsBulkSubmitting(false)}
          />
        )}
      </AnimatePresence>

      <footer className="bg-white border-t border-slate-200 py-12 mt-24">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="bg-slate-900 p-1.5 rounded-lg">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-slate-900">SciReview AI</span>
          </div>
          <p className="text-slate-500 text-sm font-medium">
            Empowering researchers with AI-driven insights and public timestamping.
          </p>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-8">
            2026 SciReview AI — Powered by GPT-5.2
          </div>
        </div>
      </footer>
    </div>
  );
}
