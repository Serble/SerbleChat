#!/usr/bin/env python3
"""
Plot request durations from stress test timings data.
Shows duration trends over time to identify slowdowns.

Usage:
    python3 plot_timings.py [timings_file] [output_file]

Examples:
    python3 plot_timings.py                    # Uses timings.csv, outputs to plot.png
    python3 plot_timings.py timings.csv plot.html
"""

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import sys
from pathlib import Path
from datetime import datetime
import numpy as np

def load_timings(file_path):
    """Load timings CSV file and parse timestamps."""
    df = pd.read_csv(file_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    return df

def plot_timings(df, output_file='plot.png'):
    """Create comprehensive timing visualization."""
    
    # Get unique query types
    query_types = df['queryType'].unique()
    
    # Create figure with subplots
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))
    fig.suptitle('SerbleChat Stress Test - Request Duration Analysis', fontsize=16, fontweight='bold')
    
    # Color map for query types
    colors = plt.cm.tab10(np.linspace(0, 1, len(query_types)))
    color_map = {qtype: colors[i] for i, qtype in enumerate(query_types)}
    
    # ========== Plot 1: All durations over time ==========
    ax1 = axes[0, 0]
    for qtype in query_types:
        data = df[df['queryType'] == qtype]
        ax1.scatter(data['timestamp'], data['durationMs'], 
                   label=qtype, alpha=0.6, s=30, color=color_map[qtype])
    
    ax1.set_xlabel('Time', fontsize=10)
    ax1.set_ylabel('Duration (ms)', fontsize=10)
    ax1.set_title('Request Durations Over Time', fontsize=12, fontweight='bold')
    ax1.legend(loc='best', fontsize=8)
    ax1.grid(True, alpha=0.3)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45, ha='right')
    
    # ========== Plot 2: Duration distribution by query type ==========
    ax2 = axes[0, 1]
    data_by_type = [df[df['queryType'] == qtype]['durationMs'].values for qtype in query_types]
    bp = ax2.boxplot(data_by_type, labels=query_types, patch_artist=True)
    
    # Color the boxes
    for patch, qtype in zip(bp['boxes'], query_types):
        patch.set_facecolor(color_map[qtype])
        patch.set_alpha(0.7)
    
    ax2.set_ylabel('Duration (ms)', fontsize=10)
    ax2.set_title('Duration Distribution by Query Type', fontsize=12, fontweight='bold')
    ax2.grid(True, alpha=0.3, axis='y')
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45, ha='right')
    
    # ========== Plot 3: Rolling average by query type ==========
    ax3 = axes[1, 0]
    for qtype in query_types:
        data = df[df['queryType'] == qtype].sort_values('timestamp')
        if len(data) > 10:
            rolling_avg = data['durationMs'].rolling(window=10).mean()
            ax3.plot(data['timestamp'], rolling_avg, label=qtype, linewidth=2, color=color_map[qtype])
        else:
            ax3.plot(data['timestamp'], data['durationMs'], label=qtype, linewidth=2, color=color_map[qtype])
    
    ax3.set_xlabel('Time', fontsize=10)
    ax3.set_ylabel('Duration (ms)', fontsize=10)
    ax3.set_title('Rolling Average Duration (10-request window)', fontsize=12, fontweight='bold')
    ax3.legend(loc='best', fontsize=8)
    ax3.grid(True, alpha=0.3)
    ax3.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax3.xaxis.get_majorticklabels(), rotation=45, ha='right')
    
    # ========== Plot 4: Success rate and statistics ==========
    ax4 = axes[1, 1]
    ax4.axis('off')
    
    # Calculate statistics
    stats_text = "📊 STATISTICS\n" + "=" * 50 + "\n\n"
    
    stats_text += f"Total Requests: {len(df):,}\n"
    stats_text += f"Time Range: {df['timestamp'].min().strftime('%H:%M:%S')} to {df['timestamp'].max().strftime('%H:%M:%S')}\n"
    stats_text += f"Duration: {(df['timestamp'].max() - df['timestamp'].min()).total_seconds():.1f}s\n\n"
    
    stats_text += "By Query Type:\n"
    for qtype in sorted(query_types):
        data = df[df['queryType'] == qtype]
        success_count = data['success'].sum()
        success_rate = (success_count / len(data) * 100) if len(data) > 0 else 0
        min_dur = data['durationMs'].min()
        max_dur = data['durationMs'].max()
        avg_dur = data['durationMs'].mean()
        median_dur = data['durationMs'].median()
        p95_dur = data['durationMs'].quantile(0.95)
        
        stats_text += f"\n  {qtype}:\n"
        stats_text += f"    Count: {len(data):,}\n"
        stats_text += f"    Success Rate: {success_rate:.1f}%\n"
        stats_text += f"    Duration - Min: {min_dur:.0f}ms, Max: {max_dur:.0f}ms\n"
        stats_text += f"    Duration - Avg: {avg_dur:.1f}ms, Median: {median_dur:.1f}ms\n"
        stats_text += f"    Duration - P95: {p95_dur:.1f}ms\n"
    
    ax4.text(0.05, 0.95, stats_text, transform=ax4.transAxes, 
            fontsize=9, verticalalignment='top', fontfamily='monospace',
            bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.3))
    
    plt.tight_layout()
    
    # Save figure
    if output_file.endswith('.html'):
        # Save as interactive HTML
        try:
            import plotly.graph_objects as go
            import plotly.express as px
            
            # Create interactive plots
            fig_int = go.Figure()
            
            for qtype in query_types:
                data = df[df['queryType'] == qtype]
                fig_int.add_trace(go.Scatter(
                    x=data['timestamp'],
                    y=data['durationMs'],
                    mode='markers',
                    name=qtype,
                    marker=dict(size=5, opacity=0.6)
                ))
            
            fig_int.update_layout(
                title='SerbleChat Stress Test - Request Durations',
                xaxis_title='Time',
                yaxis_title='Duration (ms)',
                hovermode='closest',
                height=600
            )
            
            fig_int.write_html(output_file)
            print(f"✓ Interactive HTML plot saved to {output_file}")
        except ImportError:
            print("⚠ Plotly not available, saving as PNG instead")
            plt.savefig(output_file.replace('.html', '.png'), dpi=300, bbox_inches='tight')
            output_file = output_file.replace('.html', '.png')
            print(f"✓ Plot saved to {output_file}")
    else:
        # Save as PNG
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        print(f"✓ Plot saved to {output_file}")
    
    plt.show()

def main():
    # Parse arguments
    timings_file = sys.argv[1] if len(sys.argv) > 1 else 'timings.csv'
    output_file = sys.argv[2] if len(sys.argv) > 2 else 'plot.png'
    
    # Check if file exists
    if not Path(timings_file).exists():
        print(f"✗ Error: {timings_file} not found")
        sys.exit(1)
    
    print(f"📊 Loading timings from {timings_file}...")
    
    try:
        df = load_timings(timings_file)
        print(f"✓ Loaded {len(df):,} timing records")
        
        if len(df) == 0:
            print("✗ Error: No data in timings file")
            sys.exit(1)
        
        print(f"📈 Creating plots...")
        plot_timings(df, output_file)
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
