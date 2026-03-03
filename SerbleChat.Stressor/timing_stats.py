#!/usr/bin/env python3
"""
Quick statistics summary from timings data without generating plots.

Usage:
    python3 timing_stats.py [timings_file]

Examples:
    python3 timing_stats.py                # Uses timings.csv
    python3 timing_stats.py my_timings.csv
"""

import pandas as pd
import sys
from pathlib import Path
import numpy as np

def print_stats(file_path):
    """Print detailed timing statistics."""
    
    # Load data
    df = pd.read_csv(file_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    print("\n" + "="*70)
    print("REQUEST TIMING STATISTICS")
    print("="*70 + "\n")
    
    # Overall stats
    print(f"📊 OVERALL SUMMARY")
    print(f"  Total Requests:    {len(df):,}")
    print(f"  Time Range:        {df['timestamp'].min().strftime('%H:%M:%S')} to {df['timestamp'].max().strftime('%H:%M:%S')}")
    duration = (df['timestamp'].max() - df['timestamp'].min()).total_seconds()
    print(f"  Test Duration:     {duration:.1f}s ({duration/60:.1f} minutes)")
    print(f"  Requests/Second:   {len(df)/duration:.1f}")
    
    total_success = df['success'].sum()
    total_failed = len(df) - total_success
    success_rate = (total_success / len(df) * 100) if len(df) > 0 else 0
    print(f"  Success:           {total_success:,} ({success_rate:.1f}%)")
    print(f"  Failed:            {total_failed:,} ({100-success_rate:.1f}%)")
    
    # Overall duration stats
    print(f"\n⏱️  OVERALL DURATION")
    print(f"  Min:               {df['durationMs'].min():.1f}ms")
    print(f"  Max:               {df['durationMs'].max():.1f}ms")
    print(f"  Mean:              {df['durationMs'].mean():.1f}ms")
    print(f"  Median:            {df['durationMs'].median():.1f}ms")
    print(f"  Std Dev:           {df['durationMs'].std():.1f}ms")
    print(f"  P95:               {df['durationMs'].quantile(0.95):.1f}ms")
    print(f"  P99:               {df['durationMs'].quantile(0.99):.1f}ms")
    
    # By query type
    print(f"\n📋 BY QUERY TYPE\n")
    
    query_types = sorted(df['queryType'].unique())
    
    for qtype in query_types:
        data = df[df['queryType'] == qtype]
        success_count = data['success'].sum()
        success_pct = (success_count / len(data) * 100) if len(data) > 0 else 0
        
        print(f"  {qtype}")
        print(f"    Count:           {len(data):,}")
        print(f"    Success Rate:    {success_pct:.1f}% ({success_count:,}/{len(data):,})")
        print(f"    Duration:")
        print(f"      Min:           {data['durationMs'].min():.1f}ms")
        print(f"      Max:           {data['durationMs'].max():.1f}ms")
        print(f"      Mean:          {data['durationMs'].mean():.1f}ms")
        print(f"      Median:        {data['durationMs'].median():.1f}ms")
        print(f"      P95:           {data['durationMs'].quantile(0.95):.1f}ms")
        print(f"      P99:           {data['durationMs'].quantile(0.99):.1f}ms")
        print()
    
    # By bot
    print(f"📱 BY BOT\n")
    
    for botId in sorted(df['botId'].unique()):
        data = df[df['botId'] == botId]
        success_count = data['success'].sum()
        success_pct = (success_count / len(data) * 100) if len(data) > 0 else 0
        
        print(f"  Bot {botId}")
        print(f"    Requests:       {len(data):,}")
        print(f"    Success Rate:   {success_pct:.1f}%")
        print(f"    Avg Duration:   {data['durationMs'].mean():.1f}ms")
        print()
    
    # Slowest requests
    print(f"🐢 SLOWEST REQUESTS (Top 10)\n")
    
    slowest = df.nlargest(10, 'durationMs')[['timestamp', 'botId', 'queryType', 'durationMs', 'success']]
    for idx, row in slowest.iterrows():
        status = "✓" if row['success'] else "✗"
        print(f"  {status} {row['timestamp'].strftime('%H:%M:%S')} - Bot {row['botId']:2d} - {row['queryType']:15s} - {row['durationMs']:7.1f}ms")
    
    print("\n" + "="*70 + "\n")

def main():
    file_path = sys.argv[1] if len(sys.argv) > 1 else 'timings.csv'
    
    if not Path(file_path).exists():
        print(f"✗ Error: {file_path} not found")
        sys.exit(1)
    
    try:
        print_stats(file_path)
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
