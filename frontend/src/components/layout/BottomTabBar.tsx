import { Link } from 'react-router-dom';
import { Home, Briefcase, BarChart3, Settings } from 'lucide-react';

export function BottomTabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-around items-center bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 h-14 pb-[env(safe-area-inset-bottom)]">
      <Link to='/' className='flex flex-col items-center text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400'>
        <Home className='w-5 h-5' />
        <span className='text-xs'>Dashboard</span>
      </Link>
      <Link to='/opportunities' className='flex flex-col items-center text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400'>
        <Briefcase className='w-5 h-5' />
        <span className='text-xs'>Employers</span>
      </Link>
      <Link to='/reports' className='flex flex-col items-center text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400'>
        <BarChart3 className='w-5 h-5' />
        <span className='text-xs'>Reports</span>
      </Link>
      <Link to='/settings' className='flex flex-col items-center text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400'>
        <Settings className='w-5 h-5' />
        <span className='text-xs'>Settings</span>
      </Link>
    </nav>
  );
}
