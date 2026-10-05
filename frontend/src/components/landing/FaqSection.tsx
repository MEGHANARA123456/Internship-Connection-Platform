import { ChevronDown } from 'lucide-react'

const faqs = [
  {
    q: "How are companies verified?",
    a: "Every company undergoes a manual review by our moderation team. We check their corporate registration, review their history, and ensure they meet our standards for fair internships before they can post roles."
  },
  {
    q: "Is it free for students?",
    a: "Yes, InternSphere is 100% free for students. You can create a profile, apply to unlimited roles, and schedule interviews without ever paying a fee."
  },
  {
    q: "How are interviews scheduled?",
    a: "Employers can propose time slots directly through the platform. Students receive a notification and can confirm a slot with one click, automatically generating a calendar invite for both parties."
  },
  {
    q: "How are disputes handled?",
    a: "If issues arise during an internship, both parties can open a dispute through our moderation console. Our admin team acts as an impartial mediator to resolve conflicts fairly."
  },
  {
    q: "Is my data private?",
    a: "Absolutely. We are fully GDPR and CCPA compliant. Your profile is only visible to companies you apply to or if you explicitly opt-in to our talent discovery pool."
  }
]

export function FaqSection() {
  return (
    <section className="w-full bg-slate-50 dark:bg-slate-950 py-20 border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 mb-10 text-center">
          Common <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-500 dark:from-indigo-400 dark:to-violet-400 italic">questions.</span>
        </h2>
        
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <details key={i} className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex items-center justify-between p-6 cursor-pointer font-bold text-slate-900 dark:text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                {faq.q}
                <ChevronDown className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-6 pb-6 text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
