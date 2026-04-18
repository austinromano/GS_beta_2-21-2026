import { motion } from 'framer-motion';

interface Props {
  userName: string | undefined;
  hasProjects: boolean;
  onCreateProject: () => void;
  onCreateBeat: () => void;
  onExploreFeed: () => void;
}

export default function WelcomeHero({ userName, hasProjects, onCreateProject, onCreateBeat, onExploreFeed }: Props) {
  const firstName = userName?.split(' ')[0] || 'there';
  const heading = hasProjects ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`;
  const subheading = hasProjects
    ? 'Pick up where you left off — or start something new.'
    : 'Ghost Session lets you produce with other artists in real time — inside your DAW.';

  return (
    <motion.div
      className="flex-1 flex flex-col items-center justify-center px-8 overflow-y-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="max-w-2xl w-full text-center">
        <motion.div
          className="mx-auto mb-6"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <svg width="72" height="80" viewBox="0 0 20 22" fill="none" style={{ filter: 'drop-shadow(0 0 12px rgba(0,255,200,0.25))' }}>
            <defs>
              <linearGradient id="welcomeGhost" x1="0" y1="0" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#00FFC8" />
                <stop offset="100%" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
            <path
              d="M10 1C5.5 1 2 4.5 2 9v8l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V9c0-4.5-3.5-8-8-8z"
              fill="rgba(0,255,200,0.08)"
              stroke="url(#welcomeGhost)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <ellipse cx="7.5" cy="9.5" rx="1.6" ry="1.8" fill="url(#welcomeGhost)" opacity="0.9" />
            <ellipse cx="12.5" cy="9.5" rx="1.6" ry="1.8" fill="url(#welcomeGhost)" opacity="0.9" />
            <ellipse cx="7.5" cy="9.2" rx="0.6" ry="0.7" fill="#0A0412" />
            <ellipse cx="12.5" cy="9.2" rx="0.6" ry="0.7" fill="#0A0412" />
          </svg>
        </motion.div>

        <h1 className="text-[28px] font-bold text-white mb-2 tracking-tight">{heading}</h1>
        <p className="text-[15px] text-white/60 mb-10 max-w-md mx-auto">{subheading}</p>

        {!hasProjects && (
          <div className="grid grid-cols-3 gap-3 mb-10 text-left">
            <Step number={1} title="Create a session" body="Start a new project or beat. Invite collaborators by email." />
            <Step number={2} title="Drop stems" body="Upload mix or individual stems. Everyone hears changes live." />
            <Step number={3} title="Drag into your DAW" body="Pull any stem from the plugin straight into Ableton." />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          <PrimaryCTA onClick={onCreateProject} label="Create your first project" />
          <SecondaryCTA onClick={onCreateBeat} label="Start a beat" />
          <SecondaryCTA onClick={onExploreFeed} label="Explore the feed" />
        </div>

        {!hasProjects && (
          <p className="text-[12px] text-white/30 mt-8">
            Tip: you can also drag an audio file anywhere in the app to create a new project.
          </p>
        )}
      </div>
    </motion.div>
  );
}

function Step({ number, title, body }: { number: number; title: string; body: string }) {
  return (
    <div className="rounded-xl p-4 border border-white/10 bg-white/[0.03]">
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white mb-3" style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}>
        {number}
      </div>
      <div className="text-[13px] font-semibold text-white mb-1">{title}</div>
      <div className="text-[12px] text-white/50 leading-[1.4]">{body}</div>
    </div>
  );
}

function PrimaryCTA({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className="px-5 h-11 rounded-full text-white text-[14px] font-semibold transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
      style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}
    >
      {label}
    </motion.button>
  );
}

function SecondaryCTA({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className="px-5 h-11 rounded-full text-white text-[14px] font-semibold border border-white/15 bg-white/[0.04] hover:bg-white/[0.07] hover:border-white/25 transition-all"
    >
      {label}
    </motion.button>
  );
}
